import { CliError, type Command } from "../command.ts";
import { stateDir } from "../paths.ts";
import { table, type Doc } from "../toon.ts";
import { QuizStore } from "../store.ts";
import type { Quiz } from "../quiz.ts";

export const answersCommand: Command = {
  name: "answers",
  usage: "quiz-me answers <id>",
  description: "Show a Quiz's Answers and Clarifications, or that it is still pending; never blocks",
  flags: [],
  maxPositionals: 1,
  run(ctx) {
    const id = ctx.positionals[0];
    if (!id) throw new CliError("Missing Quiz id", ["Run `quiz-me answers <id>` with the id printed by `quiz-me ask`"]);
    const quiz = new QuizStore(stateDir(ctx.env)).get(id);
    if (!quiz) {
      throw new CliError(`Unknown Quiz: ${id}`, ["Run `quiz-me` to list recent Quizzes and their ids"]);
    }
    return renderAnswers(quiz);
  },
};

export function renderAnswers(quiz: Quiz): Doc {
  const head: Doc = { quiz: quiz.id, title: quiz.title };
  if (!quiz.submission) {
    return {
      ...head,
      status: "pending",
      count: quiz.questions.length,
      questions: table(["id", "title"], quiz.questions.map((q) => [q.id, q.title])),
      help: [`Run \`quiz-me answers ${quiz.id}\` again later; the user has not submitted yet`],
    };
  }
  const { answers } = quiz.submission;
  const yes = answers.filter((a) => a.answer === "yes").length;
  const titles = new Map(quiz.questions.map((q) => [q.id, q.title]));
  return {
    ...head,
    status: "submitted",
    count: `${answers.length} (yes: ${yes}, no: ${answers.length - yes})`,
    answers: table(
      ["id", "title", "answer", "clarification"],
      answers.map((a) => [a.id, titles.get(a.id) ?? "", a.answer, a.clarification]),
      { alwaysQuote: ["clarification"] },
    ),
  };
}
