import { randomInt } from "node:crypto";
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseQuizInput, QUIZ_ID, type Answer, type Quiz, type Submission } from "./quiz.ts";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export class AlreadySubmitted extends Error {}

/** Quizzes older than this are pruned on CLI startup. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Quizzes persisted one JSON file per Quiz in the state dir. */
export class QuizStore {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  /** Validate and persist a new Quiz. Throws InvalidInput on bad input. */
  create(raw: unknown, now = new Date()): Quiz {
    const input = parseQuizInput(raw);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const id = this.reserveId();
    const quiz: Quiz = { id, ...input, createdAt: now.toISOString() };
    this.write(quiz);
    return quiz;
  }

  /** Claim an unused id by exclusively creating its file, so concurrent asks can't collide. */
  private reserveId(): string {
    for (;;) {
      let id = "";
      for (let i = 0; i < 6; i++) id += ALPHABET[randomInt(ALPHABET.length)];
      try {
        closeSync(openSync(this.path(id), "wx", 0o600));
        return id;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
  }

  private write(quiz: Quiz): void {
    const tmp = `${this.path(quiz.id)}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(quiz, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.path(quiz.id));
  }

  get(id: string): Quiz | undefined {
    if (!QUIZ_ID.test(id)) return undefined;
    return readQuiz(this.path(id));
  }

  /**
   * Delete Quizzes created more than `maxAgeMs` before `now`, pending or not. Returns their ids.
   * Files that aren't readable Quizzes (corrupt, half-written, unknown) are left alone.
   */
  prune(now = new Date(), maxAgeMs = MAX_AGE_MS): string[] {
    const cutoff = now.getTime() - maxAgeMs;
    const removed: string[] = [];
    for (const quiz of this.list()) {
      const created = Date.parse(quiz.createdAt);
      if (!Number.isFinite(created) || created >= cutoff) continue;
      try {
        unlinkSync(this.path(quiz.id));
        removed.push(quiz.id);
      } catch {
        // Already gone (a concurrent prune) or not removable; either way, not fatal.
      }
    }
    return removed;
  }

  /** All readable Quizzes, newest first. Corrupt files are skipped. */
  list(): Quiz[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    return names
      .filter((n) => /^[a-z0-9]{6}\.json$/.test(n))
      .map((n) => readQuiz(join(this.dir, n)))
      .filter((q): q is Quiz => q !== undefined)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  /** Record a Submission, locking the Quiz. */
  submit(id: string, answers: Answer[], now = new Date()): Quiz {
    const quiz = this.get(id);
    if (!quiz) throw new Error(`Unknown Quiz: ${id}`);
    if (quiz.submission) throw new AlreadySubmitted(`Quiz ${id} is already submitted`);
    const submitted: Quiz = { ...quiz, submission: { submittedAt: now.toISOString(), answers } };
    this.write(submitted);
    return submitted;
  }
}

function readQuiz(path: string): Quiz | undefined {
  try {
    const q = JSON.parse(readFileSync(path, "utf8")) as Quiz;
    return isQuiz(q) ? q : undefined;
  } catch {
    return undefined;
  }
}

/** Enough shape-checking that a corrupt or foreign file is skipped rather than rendered. */
function isQuiz(q: unknown): q is Quiz {
  if (typeof q !== "object" || q === null) return false;
  const r = q as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    QUIZ_ID.test(r.id) &&
    typeof r.createdAt === "string" &&
    Number.isFinite(Date.parse(r.createdAt)) &&
    Array.isArray(r.questions) &&
    r.questions.length > 0 &&
    r.questions.every((x) => typeof x === "object" && x !== null && typeof x.id === "string" && typeof x.title === "string") &&
    (r.submission === undefined || (typeof r.submission === "object" && r.submission !== null && Array.isArray((r.submission as Submission).answers)))
  );
}
