import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CliError, type Command } from "../command.ts";
import { stateDir } from "../paths.ts";
import { PORT_FLAG, resolvePort } from "../port.ts";
import { InvalidInput, parseQuizInput } from "../quiz.ts";
import { openUrl } from "../opener.ts";
import { ensureServer } from "../server-control.ts";
import { QuizStore } from "../store.ts";

const SHAPE = '{"title"?: string, "questions": [{"id"?: string, "title": string, "body"?: string}]}';
const HELP = "Run `quiz-me ask --help` for the Quiz JSON shape";

export const askCommand: Command = {
  name: "ask",
  usage: "quiz-me ask [--file <path>] [--no-open] [--port <n>]  (Quiz JSON on stdin unless --file)",
  description: "Put a Quiz of yes/no Questions to the user in the browser; returns immediately",
  flags: [
    { name: "file", value: "<path>", description: "Read the Quiz JSON from a file instead of stdin" },
    { name: "no-open", description: "Don't open the browser; just print the url" },
    PORT_FLAG,
  ],
  helpExtra: {
    input: SHAPE,
    notes: [
      "Question bodies are Markdown; Question ids default to q1..qn",
      "Every Question gets a Yes/No Answer and an optional Clarification",
    ],
  },
  async run(ctx) {
    const port = resolvePort(ctx.flags.port, ctx.env);
    const text = await readInput(ctx.flags.file, ctx);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new CliError(`Invalid JSON: ${(err as Error).message}`, [HELP]);
    }
    let input;
    try {
      input = parseQuizInput(raw);
    } catch (err) {
      if (err instanceof InvalidInput) throw new CliError(err.message, [HELP]);
      throw err;
    }
    const dir = stateDir(ctx.env);
    await ensureServer(port, dir);
    const quiz = new QuizStore(dir).create(input);
    const url = `http://localhost:${port}/q/${quiz.id}`;
    let browser = "not opened (--no-open)";
    if (!ctx.flags["no-open"]) {
      const failure = await openUrl(url, ctx.env);
      if (failure) ctx.log(`could not open the browser: ${failure}`);
      browser = failure ? "failed to open (see stderr)" : "opened";
    }
    return {
      quiz: quiz.id,
      url,
      status: "pending",
      count: quiz.questions.length,
      browser,
      help: [
        browser === "opened"
          ? "Tell the user the Quiz is open in their browser at the url above"
          : "Tell the user to open the url above in their browser",
        `Run \`quiz-me answers ${quiz.id}\` to check for their Submission (never blocks)`,
      ],
    };
  },
};

async function readInput(file: string | true | undefined, ctx: { cwd: string; readStdin: () => Promise<string> }): Promise<string> {
  if (typeof file === "string") {
    try {
      return readFileSync(resolve(ctx.cwd, file), "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new CliError(`Cannot read --file ${file}: ${code === "ENOENT" ? "no such file" : code}`, [HELP]);
    }
  }
  const text = await ctx.readStdin();
  if (text.trim() === "") {
    throw new CliError("No Quiz JSON: pipe it on stdin or pass --file <path>", [
      `Run \`echo '{"questions":[{"title":"..."}]}' | quiz-me ask\``,
      HELP,
    ]);
  }
  return text;
}
