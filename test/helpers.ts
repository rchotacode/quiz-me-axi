import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const CLI = resolve(import.meta.dirname, "../src/cli.ts");

export type RunResult = { code: number | null; stdout: string; stderr: string };

export type RunOptions = {
  input?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
};

/** A sandbox: temp HOME + XDG_STATE_HOME, a free port, and a stub browser opener. */
export class Sandbox {
  readonly root: string;
  readonly home: string;
  readonly stateHome: string;
  readonly openerLog: string;
  readonly opener: string;
  port = 0;

  constructor() {
    this.root = mkdtempSync(join(tmpdir(), "quiz-me-test-"));
    this.home = join(this.root, "home");
    this.stateHome = join(this.root, "state");
    mkdirSync(this.home, { recursive: true });
    this.openerLog = join(this.root, "opened.log");
    this.opener = join(this.root, "fake-opener.sh");
    // Never open a real browser: the stub only records the URL it was given.
    writeFileSync(this.opener, `#!/bin/sh\necho "$1" >> '${this.openerLog}'\n`);
    chmodSync(this.opener, 0o755);
  }

  /** A sandbox with its own free port, so any server it starts never touches 6767. */
  static async create(): Promise<Sandbox> {
    const sb = new Sandbox();
    sb.port = await freePort();
    return sb;
  }

  /** `ask` with the browser opener suppressed. */
  ask(quiz: unknown, args: string[] = [], opts: RunOptions = {}): Promise<RunResult> {
    return this.run(["ask", "--no-open", ...args], { ...opts, input: typeof quiz === "string" ? quiz : JSON.stringify(quiz) });
  }

  get stateDir(): string {
    return join(this.stateHome, "quiz-me");
  }

  env(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
    return {
      PATH: process.env.PATH,
      HOME: this.home,
      XDG_STATE_HOME: this.stateHome,
      QUIZ_ME_PORT: this.port ? String(this.port) : undefined,
      QUIZ_ME_OPENER: this.opener,
      ...extra,
    };
  }

  run(args: string[], opts: RunOptions = {}): Promise<RunResult> {
    return runCli(args, { ...opts, env: this.env(opts.env), cwd: opts.cwd ?? this.root });
  }

  /** Kill any server process started against this sandbox's state, then delete the sandbox. */
  async cleanup(): Promise<void> {
    if (this.port) await this.run(["stop"]).catch(() => undefined);
    killServersFor(this.root);
    rmSync(this.root, { recursive: true, force: true });
  }
}

export function runCli(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.env ?? {})) if (v !== undefined) env[k] = v;
    const child = spawn(process.execPath, [CLI, ...args], {
      env,
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.end(opts.input ?? "");
  });
}

/** Server processes are started with the state dir on their command line, so we can find them. */
export function serverPidsFor(marker: string): number[] {
  const out = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
  return out
    .split("\n")
    .filter((line) => line.includes("server-main") && line.includes(marker))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter((pid) => Number.isInteger(pid) && pid !== process.pid);
}

export function killServersFor(marker: string): void {
  for (const pid of serverPidsFor(marker)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

export function freePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolvePromise(port));
      } else reject(new Error("no port"));
    });
  });
}

export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

/** Read a top-level `key: value` line from TOON output. */
export function field(toon: string, key: string): string | undefined {
  const line = toon.split("\n").find((l) => l.startsWith(`${key}: `));
  return line?.slice(key.length + 2);
}

export type SubmittedAnswer = { id: string; answer: "yes" | "no"; clarification?: string };

/** Submit a Quiz the way the browser page does. */
export function submit(port: number, id: string, answers: SubmittedAnswer[]): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/quizzes/${id}/submission`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `http://localhost:${port}` },
    body: JSON.stringify({ answers }),
  });
}
