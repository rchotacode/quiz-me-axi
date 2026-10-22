import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_AGE_MS, QuizStore } from "../src/store.ts";
import { Sandbox, field } from "./helpers.ts";

const DAY = 24 * 60 * 60 * 1000;

let sb: Sandbox;
beforeEach(async () => {
  sb = await Sandbox.create();
});
afterEach(async () => {
  await sb.cleanup();
});

function quizAged(days: number, opts: { submitted?: boolean } = {}): string {
  const store = new QuizStore(sb.stateDir);
  const quiz = store.create({ title: `${days} days old`, questions: [{ title: "One?" }] }, new Date(Date.now() - days * DAY));
  if (opts.submitted) store.submit(quiz.id, [{ id: "q1", answer: "yes", clarification: "" }]);
  return quiz.id;
}

describe("pruning Quizzes older than 7 days", () => {
  it("keeps the max age at 7 days", () => {
    expect(MAX_AGE_MS).toBe(7 * DAY);
  });

  it("QuizStore.prune removes a Quiz dated 8 days ago and keeps one dated 6 days ago", () => {
    const old = quizAged(8);
    const oldSubmitted = quizAged(8, { submitted: true });
    const recent = quizAged(6);
    const removed = new QuizStore(sb.stateDir).prune();
    expect(removed.sort()).toEqual([old, oldSubmitted].sort());
    expect(existsSync(join(sb.stateDir, `${old}.json`))).toBe(false);
    expect(existsSync(join(sb.stateDir, `${recent}.json`))).toBe(true);
  });

  it("happens automatically on CLI startup: answers on a pruned id gives the unknown-id error", async () => {
    const old = quizAged(8);
    const recent = quizAged(6);
    const r = await sb.run(["answers", old]);
    expect(r.code).toBe(1);
    expect(field(r.stdout, "error")).toBe(`Unknown Quiz: ${old}`);
    expect(r.stderr).toBe("");
    expect(field((await sb.run(["answers", recent])).stdout, "status")).toBe("pending");
  });

  it("happens on any command, e.g. the home view", async () => {
    const old = quizAged(8);
    const recent = quizAged(6);
    const r = await sb.run([]);
    expect(r.stdout).toContain(recent);
    expect(r.stdout).not.toContain(old);
    expect(field(r.stdout, "total")).toBe("1 Quiz");
    expect(existsSync(join(sb.stateDir, `${old}.json`))).toBe(false);
  });

  it("skips corrupt files in the state dir instead of failing", async () => {
    const old = quizAged(8);
    const recent = quizAged(6);
    const junk: Record<string, string> = {
      "aaaaaa.json": "{not json",
      "bbbbbb.json": "null",
      "cccccc.json": "",
      "dddddd.json": JSON.stringify({ id: "dddddd", createdAt: "not a date", questions: [] }),
      "eeeeee.json": JSON.stringify({ id: "eeeeee", createdAt: new Date(Date.now() - 30 * DAY).toISOString() }),
      "notes.txt": "hello",
    };
    for (const [name, body] of Object.entries(junk)) writeFileSync(join(sb.stateDir, name), body);
    mkdirSync(join(sb.stateDir, "ffffff.json"));

    const home = await sb.run([]);
    expect(home.code, home.stdout).toBe(0);
    expect(home.stderr).toBe("");
    expect(field(home.stdout, "total")).toBe("1 Quiz");
    expect(home.stdout).toContain(recent);

    const a = await sb.run(["answers", recent]);
    expect(a.code).toBe(0);
    expect((await sb.run(["answers", "aaaaaa"])).code).toBe(1);

    const left = readdirSync(sb.stateDir);
    expect(left).not.toContain(`${old}.json`);
    for (const name of [...Object.keys(junk), "ffffff.json", `${recent}.json`]) expect(left).toContain(name);
  });

  it("works when the state dir doesn't exist yet", async () => {
    const r = await sb.run([]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });
});
