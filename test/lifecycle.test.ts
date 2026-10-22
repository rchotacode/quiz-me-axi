import { createServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Sandbox, field, serverPidsFor, submit, waitFor } from "./helpers.ts";

const QUIZ = { questions: [{ title: "One?" }] };

let sb: Sandbox;
beforeEach(async () => {
  sb = await Sandbox.create();
});
afterEach(async () => {
  await sb.cleanup();
});

async function ask(env: Record<string, string> = {}): Promise<string> {
  const r = await sb.ask(QUIZ, [], { env });
  expect(r.code, r.stdout).toBe(0);
  return field(r.stdout, "quiz")!;
}

async function healthPid(): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${sb.port}/__quiz-me/health`);
  return ((await res.json()) as { pid: number }).pid;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("server reuse", () => {
  it("concurrent asks result in exactly one server process", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => sb.ask(QUIZ)));
    for (const r of results) expect(r.code, r.stdout).toBe(0);
    // Servers that lost the startup race exit on their own.
    await waitFor(() => serverPidsFor(sb.root).length === 1);
    const [pid] = serverPidsFor(sb.root);
    expect(await healthPid()).toBe(pid);
    for (const r of results) {
      expect((await fetch(`http://127.0.0.1:${sb.port}/q/${field(r.stdout, "quiz")}`)).status).toBe(200);
    }
  });

  it("a second ask reuses the running server", async () => {
    await ask();
    const pid = await healthPid();
    await ask();
    expect(await healthPid()).toBe(pid);
    expect(serverPidsFor(sb.root)).toEqual([pid]);
  });
});

describe("idle shutdown", () => {
  const IDLE = { QUIZ_ME_IDLE_TIMEOUT_MS: "600" };

  it("keeps running while a Quiz is pending, and exits once none are pending for the timeout", async () => {
    const id = await ask(IDLE);
    await sleep(1500);
    expect(serverPidsFor(sb.root)).toHaveLength(1);
    expect((await submit(sb.port, id, [{ id: "q1", answer: "yes" }])).status).toBe(200);
    await waitFor(() => serverPidsFor(sb.root).length === 0, 5000);
    // Answers survive the shutdown.
    expect(field((await sb.run(["answers", id])).stdout, "status")).toBe("submitted");
  });

  it("a new ask resets the idle timer", async () => {
    const env = { QUIZ_ME_IDLE_TIMEOUT_MS: "1500" };
    const first = await ask(env);
    expect((await submit(sb.port, first, [{ id: "q1", answer: "yes" }])).status).toBe(200);
    await sleep(1000); // two thirds of the way to an idle shutdown
    const pid = await healthPid();
    const second = await ask(env);
    expect(await healthPid()).toBe(pid);
    await sleep(2500); // well past when the first idle period would have ended
    expect(serverPidsFor(sb.root)).toEqual([pid]);
    expect((await submit(sb.port, second, [{ id: "q1", answer: "no" }])).status).toBe(200);
    await waitFor(() => serverPidsFor(sb.root).length === 0, 6000);
  });
});

describe("quiz-me stop", () => {
  it("stops a running server, exit 0", async () => {
    await ask();
    expect(serverPidsFor(sb.root)).toHaveLength(1);
    const r = await sb.run(["stop"]);
    expect(r.code, r.stdout).toBe(0);
    expect(r.stderr).toBe("");
    expect(field(r.stdout, "server")).toBe("stopped");
    expect(field(r.stdout, "port")).toBe(String(sb.port));
    await waitFor(() => serverPidsFor(sb.root).length === 0);
  });

  it("with no server running prints an explicit not running, exit 0, every time", async () => {
    await ask();
    await sb.run(["stop"]);
    for (let i = 0; i < 2; i++) {
      const r = await sb.run(["stop"]);
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
      expect(field(r.stdout, "server")).toBe("not running");
      expect(field(r.stdout, "port")).toBe(String(sb.port));
    }
  });

  it("honours --port", async () => {
    const r = await sb.run(["stop", "--port", "abc"]);
    expect(r.code).toBe(1);
    expect(field(r.stdout, "error")).toMatch(/port/i);
  });

  it("refuses to touch something that isn't quiz-me", async () => {
    const foreign: Server = await new Promise((resolve, reject) => {
      const srv = createServer((s) => s.destroy());
      srv.on("error", reject);
      srv.listen({ host: "127.0.0.1", port: sb.port }, () => resolve(srv));
    });
    try {
      const r = await sb.run(["stop"]);
      expect(r.code).toBe(1);
      expect(field(r.stdout, "error")).toMatch(/isn't quiz-me/);
    } finally {
      await new Promise((r) => foreign.close(r));
    }
  });

  it("ask after stop starts a fresh server; earlier Quizzes remain readable", async () => {
    const before = await ask();
    expect((await submit(sb.port, before, [{ id: "q1", answer: "yes", clarification: "kept" }])).status).toBe(200);
    const oldPid = await healthPid();
    await sb.run(["stop"]);
    await waitFor(() => serverPidsFor(sb.root).length === 0);
    const after = await ask();
    const newPid = await healthPid();
    expect(newPid).not.toBe(oldPid);
    expect(serverPidsFor(sb.root)).toEqual([newPid]);
    expect((await sb.run(["answers", before])).stdout).toContain('  q1,One?,yes,"kept"\n');
    expect(await (await fetch(`http://127.0.0.1:${sb.port}/q/${before}`)).text()).toContain("Submitted");
    expect(field((await sb.run(["answers", after])).stdout, "status")).toBe("pending");
  });
});
