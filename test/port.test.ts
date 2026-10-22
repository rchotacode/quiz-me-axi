import { connect, createServer, type Server, type Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../src/command.ts";
import { DEFAULT_PORT, resolvePort } from "../src/port.ts";
import { Sandbox, field, freePort, serverPidsFor } from "./helpers.ts";

const QUIZ = { questions: [{ title: "One?" }] };

describe("resolvePort", () => {
  it("prefers --port over QUIZ_ME_PORT over the default 6767", () => {
    expect(DEFAULT_PORT).toBe(6767);
    expect(resolvePort(undefined, {})).toBe(6767);
    expect(resolvePort(undefined, { QUIZ_ME_PORT: "7001" })).toBe(7001);
    expect(resolvePort("7002", { QUIZ_ME_PORT: "7001" })).toBe(7002);
    expect(resolvePort("7002", {})).toBe(7002);
  });

  it("treats an empty QUIZ_ME_PORT as unset", () => {
    expect(resolvePort(undefined, { QUIZ_ME_PORT: "" })).toBe(6767);
  });

  it.each([["abc"], ["0"], ["70000"], ["65536"], ["-1"], ["12.5"], ["1e3"], [" 80"], [""]])(
    "rejects port %j",
    (bad) => {
      expect(() => resolvePort(bad, {})).toThrow(CliError);
      expect(() => resolvePort(bad, {})).toThrow(/--port/);
      if (bad !== "") expect(() => resolvePort(undefined, { QUIZ_ME_PORT: bad })).toThrow(/QUIZ_ME_PORT/);
    },
  );

  it("accepts the full range 1..65535", () => {
    expect(resolvePort("1", {})).toBe(1);
    expect(resolvePort("65535", {})).toBe(65535);
  });
});

let sb: Sandbox;
beforeEach(async () => {
  sb = await Sandbox.create();
});
afterEach(async () => {
  await sb.cleanup();
});

describe("ask --port", () => {
  it("--port wins over QUIZ_ME_PORT and the printed url reflects the port used", async () => {
    const other = await freePort();
    try {
      const r = await sb.ask(QUIZ, ["--port", String(other)]);
      expect(r.code, r.stdout).toBe(0);
      const id = field(r.stdout, "quiz")!;
      expect(field(r.stdout, "url")).toBe(`http://localhost:${other}/q/${id}`);
      expect((await fetch(`http://127.0.0.1:${other}/q/${id}`)).status).toBe(200);
      // Nothing was started on the QUIZ_ME_PORT port.
      await expect(fetch(`http://127.0.0.1:${sb.port}/__quiz-me/health`)).rejects.toThrow();
    } finally {
      await sb.run(["stop", "--port", String(other)]);
    }
  });

  it("uses QUIZ_ME_PORT when there is no --port", async () => {
    const r = await sb.ask(QUIZ);
    expect(field(r.stdout, "url")).toContain(`http://localhost:${sb.port}/q/`);
  });

  it.each([["abc"], ["0"], ["70000"]])("rejects --port %s with a structured error, exit 1, and starts nothing", async (bad) => {
    const r = await sb.ask(QUIZ, ["--port", bad]);
    expect(r.code).toBe(1);
    expect(field(r.stdout, "error")).toMatch(new RegExp(`port.*${bad}`, "i"));
    expect(r.stdout).toMatch(/^help\[\d+\]:/m);
    expect(serverPidsFor(sb.root)).toEqual([]);
  });

  it.each([["abc"], ["0"], ["70000"]])("rejects QUIZ_ME_PORT=%s with a structured error, exit 1", async (bad) => {
    const r = await sb.ask(QUIZ, [], { env: { QUIZ_ME_PORT: bad } });
    expect(r.code).toBe(1);
    expect(field(r.stdout, "error")).toMatch(/QUIZ_ME_PORT/);
    expect(serverPidsFor(sb.root)).toEqual([]);
  });

  it("reuses an existing quiz-me server on the port instead of treating it as a conflict", async () => {
    const a = await sb.ask(QUIZ);
    const pids = serverPidsFor(sb.root);
    expect(pids).toHaveLength(1);
    const b = await sb.ask(QUIZ);
    expect(b.code, b.stdout).toBe(0);
    expect(serverPidsFor(sb.root)).toEqual(pids);
    for (const r of [a, b]) {
      expect((await fetch(`http://127.0.0.1:${sb.port}/q/${field(r.stdout, "quiz")}`)).status).toBe(200);
    }
  });

  it("servers on different ports coexist", async () => {
    const other = await freePort();
    try {
      const a = await sb.ask(QUIZ);
      const b = await sb.ask(QUIZ, ["--port", String(other)]);
      expect(a.code).toBe(0);
      expect(b.code).toBe(0);
      expect(serverPidsFor(sb.root)).toHaveLength(2);
      expect((await fetch(`http://127.0.0.1:${sb.port}/q/${field(a.stdout, "quiz")}`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${other}/q/${field(b.stdout, "quiz")}`)).status).toBe(200);
    } finally {
      await sb.run(["stop", "--port", String(other)]);
    }
  });
});

describe("plain TCP listener on the port", () => {
  let foreign: Server | undefined;
  const sockets: Socket[] = [];
  afterEach(async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => (foreign ? foreign.close(() => r()) : r()));
    foreign = undefined;
  });

  function listen(onConn: (s: Socket) => void): Promise<Server> {
    return new Promise((resolve, reject) => {
      const srv = createServer((s) => {
        sockets.push(s);
        s.on("error", () => undefined);
        onConn(s);
      });
      srv.on("error", reject);
      srv.listen({ host: "127.0.0.1", port: sb.port }, () => resolve(srv));
    });
  }

  it.each([
    ["accepts and never replies", (_s: Socket) => undefined],
    ["accepts and hangs up", (s: Socket) => s.destroy()],
    ["replies with garbage", (s: Socket) => s.end("SSH-2.0-OpenSSH\r\n")],
  ])("ask fails clearly when a listener %s, and no server is started", async (_name, onConn) => {
    foreign = await listen(onConn);
    const r = await sb.ask(QUIZ);
    expect(r.code).toBe(1);
    expect(field(r.stdout, "error")).toMatch(new RegExp(`Port ${sb.port} is in use by something that isn't quiz-me`));
    expect(r.stdout).toContain("--port <n>");
    expect(serverPidsFor(sb.root)).toEqual([]);
    // The foreign listener still owns the port.
    await new Promise<void>((resolve, reject) => {
      const c = connect({ host: "127.0.0.1", port: sb.port }, () => {
        c.destroy();
        resolve();
      });
      c.on("error", reject);
    });
  });
});
