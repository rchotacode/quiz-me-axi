/** Domain types and validation for Quizzes, Questions, Answers and Submissions. */

export type Question = { id: string; title: string; body?: string };

export type AnswerValue = "yes" | "no";

export type Answer = { id: string; answer: AnswerValue; clarification: string };

export type Submission = { submittedAt: string; answers: Answer[] };

export type Quiz = {
  id: string;
  title?: string;
  createdAt: string;
  questions: Question[];
  submission?: Submission;
};

export type QuizInput = {
  title?: string;
  questions: { id?: string; title: string; body?: string }[];
};

export const QUIZ_ID = /^[a-z0-9]{6}$/;

/** Raised when input from the agent or the browser is malformed. */
export class InvalidInput extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate a Quiz as supplied by the agent, assigning default Question ids `q1…qn` by position. */
export function parseQuizInput(raw: unknown): { title?: string; questions: Question[] } {
  if (!isRecord(raw)) throw new InvalidInput("Quiz must be a JSON object");
  if (raw.title !== undefined && typeof raw.title !== "string") throw new InvalidInput("Quiz title must be a string");
  if (!Array.isArray(raw.questions)) throw new InvalidInput('Quiz needs a "questions" array');
  if (raw.questions.length === 0) throw new InvalidInput("Quiz needs at least one Question");
  const seen = new Set<string>();
  const questions = raw.questions.map((q: unknown, i): Question => {
    const n = i + 1;
    if (!isRecord(q)) throw new InvalidInput(`Question ${n} must be an object`);
    if (typeof q.title !== "string" || q.title.trim() === "") throw new InvalidInput(`Question ${n} needs a non-empty title`);
    if (q.body !== undefined && typeof q.body !== "string") throw new InvalidInput(`Question ${n} body must be a string`);
    if (q.id !== undefined && (typeof q.id !== "string" || q.id.trim() === "")) {
      throw new InvalidInput(`Question ${n} id must be a non-empty string`);
    }
    const id = (q.id as string | undefined) ?? `q${n}`;
    if (seen.has(id)) throw new InvalidInput(`Duplicate Question id: ${id}`);
    seen.add(id);
    return { id, title: q.title, ...(q.body !== undefined && q.body !== "" ? { body: q.body as string } : {}) };
  });
  const title = typeof raw.title === "string" && raw.title.trim() !== "" ? raw.title : undefined;
  return { ...(title ? { title } : {}), questions };
}

/** Validate a Submission from the browser against its Quiz: every Question needs a Yes/No Answer. */
export function parseSubmission(quiz: Quiz, raw: unknown): Answer[] {
  if (!isRecord(raw) || !Array.isArray(raw.answers)) throw new InvalidInput('Submission needs an "answers" array');
  const byId = new Map<string, Answer>();
  for (const a of raw.answers as unknown[]) {
    if (!isRecord(a) || typeof a.id !== "string") throw new InvalidInput("Each Answer needs a Question id");
    if (!quiz.questions.some((q) => q.id === a.id)) throw new InvalidInput(`Unknown Question id: ${a.id}`);
    if (a.answer !== "yes" && a.answer !== "no") throw new InvalidInput(`Answer for ${a.id} must be "yes" or "no"`);
    if (a.clarification !== undefined && typeof a.clarification !== "string") {
      throw new InvalidInput(`Clarification for ${a.id} must be a string`);
    }
    byId.set(a.id, { id: a.id, answer: a.answer, clarification: (a.clarification as string | undefined) ?? "" });
  }
  const missing = quiz.questions.filter((q) => !byId.has(q.id)).map((q) => q.id);
  if (missing.length) throw new InvalidInput(`Every Question needs an Answer; missing: ${missing.join(", ")}`);
  return quiz.questions.map((q) => byId.get(q.id)!);
}

export function quizStatus(quiz: Quiz): "pending" | "submitted" {
  return quiz.submission ? "submitted" : "pending";
}
