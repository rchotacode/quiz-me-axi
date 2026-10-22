import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./command.ts";
import { APP_ID, CONTROL_HEADER, LOOPBACK_V4, LOOPBACK_V6, type HealthInfo } from "./server.ts";

export type Probe =
  | { state: "down" }
  | { state: "running"; info: HealthInfo }
  | { state: "foreign"; detail: string };

const PROBE_TIMEOUT_MS = 1500;
const START_TIMEOUT_MS = 5000;

/** Connect errors meaning "nothing reachable at this IPv6 loopback", e.g. a host without IPv6. */
const V6_UNREACHABLE = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT", "ENETUNREACH", "EHOSTUNREACH"]);

function httpCall(
  host: string,
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const hostHeader = host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
  return new Promise((resolve, reject) => {
    const req = request(
      { host, port, method, path, headers: { host: hostHeader, ...headers }, timeout: PROBE_TIMEOUT_MS },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    req.end();
  });
}

async function probeHost(host: string, port: number): Promise<Probe> {
  try {
    const { status, body } = await httpCall(host, port, "GET", "/__quiz-me/health");
    const info = JSON.parse(body) as HealthInfo;
    if (status === 200 && info.app === APP_ID) return { state: "running", info };
    return { state: "foreign", detail: `unexpected HTTP ${status} response on ${host}` };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ECONNREFUSED") return { state: "down" };
    if (host === LOOPBACK_V6 && code && V6_UNREACHABLE.has(code)) return { state: "down" };
    return { state: "foreign", detail: `${code ? code.toLowerCase().replace(/^e/, "") : "not a quiz-me server"} on ${host}` };
  }
}

/**
 * Is a quiz-me server on this port, nothing at all, or something else?
 * Checks both loopbacks: `localhost` URLs may land on either, so a foreign process on either one is a conflict.
 */
export async function probe(port: number): Promise<Probe> {
  const results = await Promise.all([probeHost(LOOPBACK_V4, port), probeHost(LOOPBACK_V6, port)]);
  return (
    results.find((r) => r.state === "foreign") ??
    results.find((r) => r.state === "running") ?? { state: "down" }
  );
}

function portConflict(port: number, detail: string): CliError {
  return new CliError(`Port ${port} is in use by something that isn't quiz-me (${detail})`, [
    "Run `quiz-me ask --port <n>` with a free port, or set QUIZ_ME_PORT",
  ]);
}

function serverEntry(): string {
  const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  return fileURLToPath(new URL(`./server-main${ext}`, import.meta.url));
}

/** Reuse the quiz-me server on `port`, or start a detached one. Never picks another port. */
export async function ensureServer(port: number, stateDir: string): Promise<HealthInfo> {
  const first = await probe(port);
  if (first.state === "running") return checkSameState(first.info, port, stateDir);
  if (first.state === "foreign") throw portConflict(port, first.detail);

  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const logFd = openSync(join(stateDir, "server.log"), "a", 0o600);
  const child = spawn(process.execPath, [serverEntry(), String(port), stateDir], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  child.unref();
  closeSync(logFd);

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const p = await probe(port);
    // A concurrent `ask` may have won the race; its server is just as good.
    if (p.state === "running") return checkSameState(p.info, port, stateDir);
    if (p.state === "foreign") throw portConflict(port, p.detail);
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new CliError(`The quiz-me server did not start on port ${port}`, [
    `See the server log at ${join(stateDir, "server.log")}`,
  ]);
}

function checkSameState(info: HealthInfo, port: number, stateDir: string): HealthInfo {
  if (info.stateDir !== stateDir) {
    throw new CliError(`Port ${port} is held by a quiz-me server using a different state dir (${info.stateDir})`, [
      `Run \`quiz-me stop --port ${port}\` to stop it, or use \`--port <n>\``,
    ]);
  }
  return info;
}

/** Ask the server on `port` to stop and wait until it has. */
export async function stopServer(port: number): Promise<void> {
  // IPv4 is always bound by a running server; ::1 covers one whose IPv4 side is somehow gone.
  for (const host of [LOOPBACK_V4, LOOPBACK_V6]) {
    const ok = await httpCall(host, port, "POST", "/__quiz-me/shutdown", { [CONTROL_HEADER]: "1" }).then(
      () => true,
      () => false,
    );
    if (ok) break;
  }
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await probe(port)).state === "down") return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new CliError(`The quiz-me server on port ${port} did not stop`);
}
