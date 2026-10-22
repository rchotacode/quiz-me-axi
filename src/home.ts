import type { Command } from "./command.ts";
import { stateDir, tildify } from "./paths.ts";
import { PORT_FLAG, resolvePort } from "./port.ts";
import { quizStatus } from "./quiz.ts";
import { probe } from "./server-control.ts";
import { QuizStore } from "./store.ts";
import { table, type Doc } from "./toon.ts";

export const DESCRIPTION =
  "Put a Quiz of yes/no Questions to the user in their browser and collect their Answers without blocking.";

const RECENT = 10;

export function homeCommand(binPath: string): Command {
  return {
    name: "",
    usage: "quiz-me [command] [--port <n>] [--help]",
    description: DESCRIPTION,
    flags: [PORT_FLAG],
    maxPositionals: 0,
    async run(ctx) {
      const port = resolvePort(ctx.flags.port, ctx.env);
      const dir = stateDir(ctx.env);
      const quizzes = new QuizStore(dir).list();
      const p = await probe(port);
      const portArg = typeof ctx.flags.port === "string" ? ` --port ${port}` : "";

      let server: string;
      if (p.state === "down") server = `not running (port ${port})`;
      else if (p.state === "foreign") server = `port ${port} is in use by something that isn't quiz-me`;
      else if (p.info.stateDir !== dir) server = `a quiz-me server for another state dir (${tildify(p.info.stateDir, ctx.env)}) is on port ${port}`;
      else server = `running on port ${port}`;
      const running = p.state === "running" && p.info.stateDir === dir;

      const doc: Doc = { bin: tildify(binPath, ctx.env), description: DESCRIPTION, server };
      const help: string[] = [];
      if (quizzes.length === 0) {
        doc.quizzes = "none yet";
        help.push("Run `quiz-me ask --help` to see how to put a Quiz to the user");
      } else {
        const shown = quizzes.slice(0, RECENT);
        doc.total = `${quizzes.length} ${quizzes.length === 1 ? "Quiz" : "Quizzes"}${quizzes.length > RECENT ? ` (${RECENT} most recent shown)` : ""}`;
        doc.quizzes = table(
          ["id", "title", "status", "count"],
          shown.map((q) => [q.id, q.title ?? "", quizStatus(q), q.questions.length]),
        );
        const pending = quizzes.some((q) => !q.submission);
        help.push("Run `quiz-me answers <id>` to read a Quiz's Answers, or see that it is still pending");
        if (pending && p.state === "down") {
          help.push(`The server is not running, so pending Quiz pages won't load; any \`quiz-me ask${portArg}\` restarts it`);
        }
        help.push("Run `quiz-me ask --help` to put a new Quiz to the user");
      }
      if (running) help.push(`Run \`quiz-me stop${portArg}\` to stop the server; Answers stay readable`);
      if (p.state === "foreign") help.push("Run `quiz-me ask --port <n>` with a free port, or set QUIZ_ME_PORT");
      help.push("Run `quiz-me skill` for the agent guide");
      doc.help = help;
      return doc;
    },
  };
}
