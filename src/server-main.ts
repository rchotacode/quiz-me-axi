/**
 * Detached server process entry: `node server-main.(ts|js) <port> <stateDir>`.
 * The state dir is on the command line so the process is identifiable in `ps`.
 *
 * Listens on 127.0.0.1 and, when the host has IPv6, on ::1 too (same port), because the
 * printed `http://localhost:<port>` URL may resolve to either. Never binds a non-loopback address.
 */
import { createServer, type Server } from "node:http";
import { IdleMonitor, idleTimeoutMs } from "./idle.ts";
import { createQuizHandler, LOOPBACK_V4, LOOPBACK_V6 } from "./server.ts";
import { QuizStore } from "./store.ts";

const port = Number(process.argv[2]);
const stateDir = process.argv[3];
if (!Number.isInteger(port) || !stateDir) {
  console.error("usage: server-main <port> <stateDir>");
  process.exit(1);
}

/** Errors meaning "this host has no usable IPv6 loopback", as opposed to "someone else holds the port". */
const NO_IPV6 = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT", "EPROTONOSUPPORT", "EINVAL"]);

const store = new QuizStore(stateDir);
const idle = new IdleMonitor({
  timeoutMs: idleTimeoutMs(process.env),
  hasPending: () => store.list().some((q) => !q.submission),
  onIdle: () => shutdown("idle: no pending Quizzes"),
});
const handler = createQuizHandler({
  port,
  stateDir,
  onShutdown: () => shutdown("stop requested"),
  onActivity: () => idle.activity(),
});
const servers: Server[] = [];

function shutdown(reason: string): void {
  console.error(`quiz-me server on port ${port}: shutting down (${reason})`);
  for (const s of servers) {
    s.close();
    s.closeAllConnections();
  }
  process.exit(0);
}

function listen(host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once("error", reject);
    server.listen({ port, host, ipv6Only: host === LOOPBACK_V6 }, () => {
      server.off("error", reject);
      server.on("error", (err) => console.error(`quiz-me server on port ${port} (${host}): ${err.message}`));
      servers.push(server);
      resolve(server);
    });
  });
}

function fail(host: string, err: NodeJS.ErrnoException): never {
  // Another server won the race for this port (or something else holds it); the CLI sorts out which.
  console.error(`quiz-me server on port ${port} (${host}): ${err.code ?? err.message}`);
  process.exit(1);
}

// IPv4 first: of two racing servers, the loser fails here before it touches ::1.
await listen(LOOPBACK_V4).catch((err) => fail(LOOPBACK_V4, err));
const hosts = [LOOPBACK_V4];
try {
  await listen(LOOPBACK_V6);
  hosts.push(LOOPBACK_V6);
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  // A foreign process on [::1]:<port> would capture `localhost` URLs, so that is fatal; no IPv6 at all is not.
  if (!NO_IPV6.has(e.code ?? "")) fail(LOOPBACK_V6, e);
  console.error(`quiz-me server on port ${port}: IPv6 loopback unavailable (${e.code}); serving IPv4 only`);
}
console.error(`quiz-me server on port ${port}: listening on ${hosts.join(", ")} (pid ${process.pid}, state ${stateDir})`);

setInterval(() => idle.tick(), idle.tickMs);

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
