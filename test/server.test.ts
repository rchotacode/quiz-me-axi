import { request } from "node:http";
import { connect, createServer, type Server } from "node:net";
import { networkInterfaces } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Sandbox, field, serverPidsFor, submit, waitFor } from "./helpers.ts";

/** GET over IPv6 loopback with the Host header a browser sends for http://[::1]:<port>. */
function getV6(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "::1", family: 6, port, path, headers: { host: `[::1]:${port}` } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const QUIZ = { questions: [{ title: "Use Postgres?" }, { title: "Add caching?" }, { title: "Ship Friday?" }] };

let sb: Sandbox;
beforeEach(async () => {
  sb = await Sandbox.create();
});
afterEach(async () => {
  await sb.cleanup();
});

async function ask(quiz: unknown = QUIZ): Promise<string> {
  const r = await sb.ask(quiz);
  expect(r.code, r.stdout).toBe(0);
  return field(r.stdout, "quiz")!;
}

describe("Quiz page and Submission", () => {
  it("ask starts a server that serves the Quiz page with Yes/No, Clarification and Submit controls", async () => {
    const id = await ask();
    const res = await fetch(`http://127.0.0.1:${sb.port}/q/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    for (const t of ["Use Postgres?", "Add caching?", "Ship Friday?"]) expect(html).toContain(t);
    expect(html.match(/data-answer="yes"/g)).toHaveLength(3);
    expect(html.match(/data-answer="no"/g)).toHaveLength(3);
    expect(html.match(/<textarea/g)).toHaveLength(3);
    expect(html).toMatch(/<button[^>]*type="submit"/);
  });

  it("a Submission makes answers report submitted with the right rows and counts", async () => {
    const id = await ask();
    const res = await submit(sb.port, id, [
      { id: "q1", answer: "yes" },
      { id: "q2", answer: "no", clarification: "Not until we measure" },
      { id: "q3", answer: "yes", clarification: "" },
    ]);
    expect(res.status).toBe(200);
    const r = await sb.run(["answers", id]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(
      `quiz: ${id}\n` +
        "status: submitted\n" +
        "count: 3 (yes: 2, no: 1)\n" +
        "answers[3]{id,title,answer,clarification}:\n" +
        "  q1,Use Postgres?,yes,\n" +
        '  q2,Add caching?,no,"Not until we measure"\n' +
        "  q3,Ship Friday?,yes,\n",
    );
  });

  it("round-trips long Clarifications with commas, quotes and newlines verbatim and untruncated", async () => {
    const id = await ask({ questions: [{ title: "One?" }] });
    const clarification = `Yes, but "only" if:\n- a, b\n- c\\d\n` + "x".repeat(5000) + "\tend";
    expect((await submit(sb.port, id, [{ id: "q1", answer: "yes", clarification }])).status).toBe(200);
    const r = await sb.run(["answers", id]);
    const row = r.stdout.split("\n").find((l) => l.startsWith("  q1,"))!;
    const cell = row.slice("  q1,One?,yes,".length);
    expect(JSON.parse(cell)).toBe(clarification);
  });

  it("rejects a Submission missing any Answer and leaves the Quiz pending", async () => {
    const id = await ask();
    const res = await submit(sb.port, id, [
      { id: "q1", answer: "yes" },
      { id: "q3", answer: "no" },
    ]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/q2/);
    expect(field((await sb.run(["answers", id])).stdout, "status")).toBe("pending");
  });

  it("rejects an Answer that isn't yes or no", async () => {
    const id = await ask({ questions: [{ title: "One?" }] });
    const res = await submit(sb.port, id, [{ id: "q1", answer: "maybe" as "yes" }]);
    expect(res.status).toBe(400);
  });

  it("rejects re-submitting a submitted Quiz and keeps the stored Answers", async () => {
    const id = await ask({ questions: [{ title: "One?" }] });
    expect((await submit(sb.port, id, [{ id: "q1", answer: "yes", clarification: "first" }])).status).toBe(200);
    const before = (await sb.run(["answers", id])).stdout;
    const again = await submit(sb.port, id, [{ id: "q1", answer: "no", clarification: "second" }]);
    expect(again.status).toBe(409);
    expect((await sb.run(["answers", id])).stdout).toBe(before);
  });

  it("returns 404 for a Submission or page of an unknown Quiz", async () => {
    await ask();
    expect((await submit(sb.port, "zzzzzz", [{ id: "q1", answer: "yes" }])).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${sb.port}/q/zzzzzz`)).status).toBe(404);
  });

  it("rejects cross-origin Submissions", async () => {
    const id = await ask({ questions: [{ title: "One?" }] });
    const res = await fetch(`http://127.0.0.1:${sb.port}/api/quizzes/${id}/submission`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ answers: [{ id: "q1", answer: "yes" }] }),
    });
    expect(res.status).toBe(403);
    expect(field((await sb.run(["answers", id])).stdout, "status")).toBe("pending");
  });
});

describe("server process", () => {
  function canConnect(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const s = connect({ host, port });
      s.once("connect", () => {
        s.destroy();
        resolve(true);
      });
      s.once("error", () => resolve(false));
    });
  }

  it("listens on IPv4 and IPv6 loopback only", async () => {
    await ask();
    expect(await canConnect("127.0.0.1", sb.port)).toBe(true);
    expect(await canConnect("::1", sb.port)).toBe(true);
    const external = Object.entries(networkInterfaces()).flatMap(([name, addrs]) =>
      (addrs ?? [])
        .filter((i) => !i.internal)
        .map((i) => (i.family === "IPv6" && i.address.startsWith("fe80:") ? `${i.address}%${name}` : i.address)),
    );
    for (const addr of external) expect(await canConnect(addr, sb.port), addr).toBe(false);
  });

  it("serves the Quiz page at http://[::1]:<port>/q/<id>", async () => {
    const id = await ask();
    const res = await getV6(sb.port, `/q/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("Use Postgres?");
  });

  it("accepts a Submission over IPv6 loopback with an [::1] Origin", async () => {
    const id = await ask({ questions: [{ title: "One?" }] });
    const res = await fetch(`http://[::1]:${sb.port}/api/quizzes/${id}/submission`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: `http://[::1]:${sb.port}` },
      body: JSON.stringify({ answers: [{ id: "q1", answer: "yes", clarification: "via v6" }] }),
    });
    expect(res.status).toBe(200);
    const r = await sb.run(["answers", id]);
    expect(field(r.stdout, "status")).toBe("submitted");
    expect(r.stdout).toContain('  q1,One?,yes,"via v6"\n');
  });

  it("still refuses foreign Host headers over IPv6", async () => {
    const id = await ask();
    const res = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "::1", family: 6, port: sb.port, path: `/q/${id}`, headers: { host: `evil.example:${sb.port}` } }, (r) => {
        r.resume();
        resolve(r.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    expect(res).toBe(403);
  });

  it("answers still works after the server process is killed", async () => {
    const id = await ask({ questions: [{ title: "One?" }] });
    await submit(sb.port, id, [{ id: "q1", answer: "no", clarification: "nope" }]);
    const pids = serverPidsFor(sb.root);
    expect(pids).toHaveLength(1);
    process.kill(pids[0]!, "SIGKILL");
    await waitFor(() => serverPidsFor(sb.root).length === 0);
    const r = await sb.run(["answers", id]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('  q1,One?,no,"nope"\n');
  });
});

describe("port held by something else", () => {
  let foreign: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((r) => (foreign ? foreign.close(() => r()) : r()));
    foreign = undefined;
  });

  function holdPort(host: string, port: number): Promise<Server> {
    return new Promise((resolve, reject) => {
      const srv = createServer((s) => {
        s.on("error", () => undefined);
        s.end("HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-length: 2\r\n\r\nhi", () => s.destroy());
      });
      srv.on("error", reject);
      srv.listen({ host, port, ipv6Only: true }, () => resolve(srv));
    });
  }

  it.each([["127.0.0.1"], ["::1"]])("ask reports a port conflict when a foreign process holds %s", async (host) => {
    foreign = await holdPort(host, sb.port);
    const r = await sb.ask(QUIZ);
    expect(r.code).toBe(1);
    expect(field(r.stdout, "error")).toMatch(/isn't quiz-me/);
    expect(serverPidsFor(sb.root)).toEqual([]);
  });
});
