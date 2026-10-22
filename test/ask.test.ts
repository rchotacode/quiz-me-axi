import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Sandbox, field } from "./helpers.ts";

const QUIZ = {
  title: "Storage decisions",
  questions: [{ title: "Use Postgres?" }, { id: "cache", title: "Add caching?", body: "We have no metrics yet." }, { title: "Ship Friday?" }],
};

let sb: Sandbox;
beforeEach(async () => {
  sb = await Sandbox.create();
});
afterEach(async () => {
  await sb.cleanup();
});

describe("quiz-me ask", () => {
  it("persists a Quiz from stdin and prints its id, url, status, count and next step", async () => {
    const r = await sb.ask(QUIZ);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const id = field(r.stdout, "quiz")!;
    expect(id).toMatch(/^[a-z0-9]{6}$/);
    expect(field(r.stdout, "url")).toBe(`http://localhost:${sb.port}/q/${id}`);
    expect(field(r.stdout, "status")).toBe("pending");
    expect(field(r.stdout, "count")).toBe("3");
    expect(r.stdout).toContain(`quiz-me answers ${id}`);
  });

  it("accepts the Quiz via --file with the same result as stdin", async () => {
    const file = join(sb.root, "quiz.json");
    writeFileSync(file, JSON.stringify(QUIZ));
    const viaFile = await sb.run(["ask", "--no-open", "--file", file]);
    const viaStdin = await sb.ask(QUIZ);
    expect(viaFile.code).toBe(0);
    const strip = (out: string, id: string) => out.replaceAll(id, "<id>");
    expect(strip(viaFile.stdout, field(viaFile.stdout, "quiz")!)).toBe(strip(viaStdin.stdout, field(viaStdin.stdout, "quiz")!));
  });

  it("defaults missing Question ids to q1..qn by position and preserves supplied ids", async () => {
    const r = await sb.ask(QUIZ);
    const id = field(r.stdout, "quiz")!;
    // Submit through nothing yet: the ids are visible in the pending answers listing.
    const a = await sb.run(["answers", id]);
    expect(a.stdout).toContain("questions[3]{id,title}:\n  q1,Use Postgres?\n  cache,Add caching?\n  q3,Ship Friday?\n");
  });

  it.each([
    ["invalid JSON", "{not json", /invalid JSON/i],
    ["empty questions", { questions: [] }, /at least one Question/i],
    ["missing questions", { title: "x" }, /questions/i],
    ["a Question without a title", { questions: [{ body: "no title" }] }, /Question 1.*title/i],
    ["a blank Question title", { questions: [{ title: "  " }] }, /Question 1.*title/i],
    ["duplicate Question ids", { questions: [{ id: "a", title: "A" }, { id: "a", title: "B" }] }, /duplicate Question id: a/i],
    ["a supplied id clashing with a default", { questions: [{ title: "A" }, { id: "q1", title: "B" }] }, /duplicate Question id: q1/i],
    ["no input at all", "", /no Quiz JSON/i],
  ])("rejects %s with a structured error, exit 1", async (_name, input, message) => {
    const r = await sb.ask(input);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^error: /);
    expect(field(r.stdout, "error")).toMatch(message);
    expect(r.stdout).toMatch(/^help\[\d+\]:/m);
    expect(existsSync(sb.stateDir) ? readdirSync(sb.stateDir).filter((f) => f.endsWith(".json")) : []).toEqual([]);
  });

  it("rejects a nonexistent --file with a structured error, exit 1", async () => {
    const r = await sb.run(["ask", "--no-open", "--file", join(sb.root, "missing.json")]);
    expect(r.code).toBe(1);
    expect(field(r.stdout, "error")).toMatch(/missing\.json/);
  });

  it("stores Quizzes under $XDG_STATE_HOME/quiz-me", async () => {
    const r = await sb.ask(QUIZ);
    const id = field(r.stdout, "quiz")!;
    expect(existsSync(join(sb.stateHome, "quiz-me", `${id}.json`))).toBe(true);
  });

  it("falls back to ~/.local/state/quiz-me when XDG_STATE_HOME is unset", async () => {
    const r = await sb.ask(QUIZ, [], { env: { XDG_STATE_HOME: undefined } });
    const id = field(r.stdout, "quiz")!;
    expect(existsSync(join(sb.home, ".local", "state", "quiz-me", `${id}.json`))).toBe(true);
    const a = await sb.run(["answers", id], { env: { XDG_STATE_HOME: undefined } });
    expect(field(a.stdout, "status")).toBe("pending");
  });
});

describe("quiz-me answers", () => {
  it("reports pending for an unsubmitted Quiz, identically on every call", async () => {
    const id = field((await sb.ask(QUIZ)).stdout, "quiz")!;
    const first = await sb.run(["answers", id]);
    const second = await sb.run(["answers", id]);
    expect(first.code).toBe(0);
    expect(first.stderr).toBe("");
    expect(field(first.stdout, "quiz")).toBe(id);
    expect(field(first.stdout, "status")).toBe("pending");
    expect(first.stdout).toContain(`quiz-me answers ${id}`);
    expect(second.stdout).toBe(first.stdout);
  });

  it.each([["zzzzzz"], ["../etc"], ["ABC123"]])("rejects unknown id %s with a structured error, exit 1", async (id) => {
    const r = await sb.run(["answers", id]);
    expect(r.code).toBe(1);
    expect(field(r.stdout, "error")).toContain(`Unknown Quiz: ${id}`);
    expect(r.stdout).toMatch(/^help\[\d+\]:/m);
  });

  it("requires an id", async () => {
    const r = await sb.run(["answers"]);
    expect(r.code).toBe(1);
    expect(field(r.stdout, "error")).toMatch(/Quiz id/);
  });
});
