import { readFileSync } from "node:fs";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { renderNotFoundPage, renderQuizPage } from "./page.ts";
import { InvalidInput, parseSubmission } from "./quiz.ts";
import { AlreadySubmitted, QuizStore } from "./store.ts";

export const APP_ID = "quiz-me";

/** Header the CLI sends on control requests; browsers can't send it cross-origin without a preflight we never grant. */
export const CONTROL_HEADER = "x-quiz-me-control";

export type HealthInfo = { app: typeof APP_ID; pid: number; port: number; stateDir: string };

export type ServerOptions = {
  port: number;
  stateDir: string;
  /** Called on a control shutdown request after the response is sent. */
  onShutdown: () => void;
  /** Called on every request (used to reset the idle timer). */
  onActivity?: () => void;
};

const WEB_DIR = fileURLToPath(new URL("./web/", import.meta.url));
const ASSETS: Record<string, string> = {
  "/assets/app.js": "text/javascript; charset=utf-8",
  "/assets/style.css": "text/css; charset=utf-8",
};

const MAX_BODY = 5 * 1024 * 1024;

/** The loopback addresses the server listens on. IPv4 is required; IPv6 is best-effort. */
export const LOOPBACK_V4 = "127.0.0.1";
export const LOOPBACK_V6 = "::1";

/** One handler (and one QuizStore) shared by the IPv4 and IPv6 listeners. */
export function createQuizHandler(opts: ServerOptions): RequestListener {
  const store = new QuizStore(opts.stateDir);
  // `localhost` may resolve to ::1 before 127.0.0.1, so all three loopback spellings are ours.
  const allowedHosts = new Set([`localhost:${opts.port}`, `127.0.0.1:${opts.port}`, `[::1]:${opts.port}`]);
  const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));

  return async (req, res) => {
    opts.onActivity?.();
    try {
      // Refuse requests addressed to any other host name (DNS-rebinding protection).
      if (!allowedHosts.has(req.headers.host ?? "")) return send(res, 403, "text/plain", "Forbidden host\n");
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const path = url.pathname;

      if (req.method === "GET" && path === "/__quiz-me/health") {
        const info: HealthInfo = { app: APP_ID, pid: process.pid, port: opts.port, stateDir: opts.stateDir };
        return json(res, 200, info);
      }
      if (req.method === "POST" && path === "/__quiz-me/shutdown") {
        if (req.headers[CONTROL_HEADER] !== "1") return json(res, 403, { error: "Forbidden" });
        res.on("finish", opts.onShutdown);
        return json(res, 200, { stopped: true, pid: process.pid });
      }
      if (req.method === "GET" && ASSETS[path]) {
        return send(res, 200, ASSETS[path], readFileSync(WEB_DIR + path.slice("/assets/".length)));
      }
      let m = /^\/q\/([^/]+)$/.exec(path);
      if (req.method === "GET" && m) {
        const quiz = store.get(m[1]!);
        if (!quiz) return send(res, 404, "text/html; charset=utf-8", renderNotFoundPage(m[1]!));
        return send(res, 200, "text/html; charset=utf-8", renderQuizPage(quiz));
      }
      m = /^\/api\/quizzes\/([^/]+)\/submission$/.exec(path);
      if (m) {
        if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
        const origin = req.headers.origin;
        if (origin !== undefined && !allowedOrigins.has(origin)) return json(res, 403, { error: "Cross-origin Submission refused" });
        const quiz = store.get(m[1]!);
        if (!quiz) return json(res, 404, { error: `Unknown Quiz: ${m[1]}` });
        if (quiz.submission) return json(res, 409, { error: "This Quiz is already submitted" });
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return json(res, 400, { error: "Submission must be JSON" });
        }
        try {
          store.submit(quiz.id, parseSubmission(quiz, body));
        } catch (err) {
          if (err instanceof InvalidInput) return json(res, 400, { error: err.message });
          if (err instanceof AlreadySubmitted) return json(res, 409, { error: "This Quiz is already submitted" });
          throw err;
        }
        return json(res, 200, { status: "submitted" });
      }
      return send(res, 404, "text/plain", "Not found\n");
    } catch (err) {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: "Internal error" });
      else res.end();
    }
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
  });
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body));
}
