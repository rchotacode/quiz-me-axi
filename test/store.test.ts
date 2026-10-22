import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { QuizStore } from "../src/store.ts";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("assigns 6-char lowercase alphanumeric Quiz ids that don't collide across 1000 Quizzes", () => {
  dir = mkdtempSync(join(tmpdir(), "quiz-me-store-"));
  const store = new QuizStore(join(dir, "quiz-me"));
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const quiz = store.create({ questions: [{ title: `Question ${i}?` }] });
    expect(quiz.id).toMatch(/^[a-z0-9]{6}$/);
    ids.add(quiz.id);
  }
  expect(ids.size).toBe(1000);
  expect(store.list()).toHaveLength(1000);
});
