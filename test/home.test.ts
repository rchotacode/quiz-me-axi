import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuizStore } from "../src/store.ts";
import { Sandbox, field } from "./helpers.ts";

let sb: Sandbox;
beforeEach(async () => {
  sb = await Sandbox.create();
});
afterEach(async () => {
  await sb.cleanup();
});

/** Create `n` Quizzes a minute apart (oldest first); every third one is submitted. Returns ids newest first. */
function seed(n: number): { id: string; submitted: boolean }[] {
  const store = new QuizStore(sb.stateDir);
  const base = Date.now() - n * 60_000;
  const made = [];
  for (let i = 0; i < n; i++) {
    const quiz = store.create(
      { title: `Quiz ${i}`, questions: Array.from({ length: (i % 3) + 1 }, (_, k) => ({ title: `Q${k}?` })) },
      new Date(base + i * 60_000),
    );
    const submitted = i % 3 === 0;
    if (submitted) store.submit(quiz.id, quiz.questions.map((q) => ({ id: q.id, answer: "yes" as const, clarification: "" })));
    made.push({ id: quiz.id, submitted });
  }
  return made.reverse();
}

function rows(out: string, key = "quizzes"): string[] {
  const lines = out.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${key}[`));
  if (start === -1) return [];
  const n = Number(/\[(\d+)\]/.exec(lines[start]!)![1]);
  return lines.slice(start + 1, start + 1 + n).map((l) => l.trim());
}

function helpLines(out: string): string[] {
  return rows(out, "help");
}

describe("home view", () => {
  it("with 12 Quizzes lists the 10 most recent and reports a total of 12", async () => {
    const made = seed(12);
    const r = await sb.run([]);
    expect(r.code, r.stdout).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toMatch(/^quizzes\[10\]\{id,title,status,count\}:$/m);
    expect(field(r.stdout, "total")).toMatch(/^12\b/);
    expect(rows(r.stdout).map((l) => l.split(",")[0])).toEqual(made.slice(0, 10).map((q) => q.id));
  });

  it("shows pending vs submitted status and each Quiz's Question count", async () => {
    const made = seed(4); // newest first: i=3 (submitted, 1 Q), i=2 (pending, 3 Qs), i=1 (pending, 2 Qs), i=0 (submitted, 1 Q)
    const r = await sb.run([]);
    expect(rows(r.stdout)).toEqual([
      `${made[0]!.id},Quiz 3,submitted,1`,
      `${made[1]!.id},Quiz 2,pending,3`,
      `${made[2]!.id},Quiz 1,pending,2`,
      `${made[3]!.id},Quiz 0,submitted,1`,
    ]);
    expect(field(r.stdout, "total")).toBe("4 Quizzes");
  });

  it("keeps the explicit empty state when there are no Quizzes", async () => {
    const r = await sb.run([]);
    expect(field(r.stdout, "quizzes")).toBe("none yet");
    expect(field(r.stdout, "total")).toBeUndefined();
  });

  it("reports the server as not running, with the port it would use", async () => {
    const r = await sb.run([]);
    expect(field(r.stdout, "server")).toBe(`not running (port ${sb.port})`);
  });

  it("reports the server as running and on which port", async () => {
    await sb.ask({ questions: [{ title: "One?" }] });
    const r = await sb.run([]);
    expect(field(r.stdout, "server")).toBe(`running on port ${sb.port}`);
    expect(helpLines(r.stdout).join("\n")).toContain("quiz-me stop");
    await sb.run(["stop"]);
    expect(field((await sb.run([])).stdout, "server")).toBe(`not running (port ${sb.port})`);
  });

  it("honours --port", async () => {
    const r = await sb.run(["--port", "1"]);
    expect(r.code).toBe(0);
    expect(field(r.stdout, "server")).toBe("not running (port 1)");
    expect((await sb.run(["--port", "0"])).code).toBe(1);
  });

  it("help[] uses <id> placeholders and never a real id", async () => {
    const made = seed(3);
    const r = await sb.run([]);
    const help = helpLines(r.stdout);
    expect(help.length).toBeGreaterThan(0);
    expect(help.join("\n")).toContain("quiz-me answers <id>");
    for (const line of help) for (const q of made) expect(line).not.toContain(q.id);
  });

  it("help[] is contextual: a down server with pending Quizzes says how to bring it back", async () => {
    seed(3);
    const help = helpLines((await sb.run([])).stdout).join("\n");
    expect(help).toMatch(/not running/i);
    expect(help).toContain("quiz-me ask");
    expect(help).not.toContain("quiz-me stop");
  });
});
