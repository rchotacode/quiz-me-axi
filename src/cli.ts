#!/usr/bin/env node
import { CliError, parseArgs, RawOutput, renderError, renderHelp, type Command } from "./command.ts";
import { answersCommand } from "./commands/answers.ts";
import { askCommand } from "./commands/ask.ts";
import { skillCommand } from "./commands/skill.ts";
import { stopCommand } from "./commands/stop.ts";
import { homeCommand } from "./home.ts";
import { stateDir } from "./paths.ts";
import { QuizStore } from "./store.ts";
import { encode } from "./toon.ts";

function commands(binPath: string): Command[] {
  return [homeCommand(binPath), askCommand, answersCommand, stopCommand, skillCommand];
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (data += d));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/** Delete Quizzes older than 7 days. Best effort: never fails or slows the command it precedes. */
function prune(): void {
  try {
    new QuizStore(stateDir(process.env)).prune();
  } catch {
    // An unreadable state dir is reported by the command that needs it, not here.
  }
}

export async function main(argv: string[]): Promise<number> {
  prune();
  const all = commands(process.argv[1] ?? "quiz-me");
  const home = all.find((c) => c.name === "")!;
  const [first, ...rest] = argv;
  let cmd = home;
  let args = argv;
  if (first !== undefined && !first.startsWith("-")) {
    const found = all.find((c) => c.name !== "" && c.name === first);
    if (!found) {
      process.stdout.write(
        renderError(new CliError(`Unknown command: ${first}`, ["Run `quiz-me --help` to see commands"])),
      );
      return 1;
    }
    cmd = found;
    args = rest;
  }
  try {
    const { flags, positionals } = parseArgs(cmd, args);
    if (flags.help) {
      const extra =
        cmd === home
          ? { commands: all.filter((c) => c.name).map((c) => `${c.name.padEnd(8)} ${c.description}`) }
          : {};
      process.stdout.write(renderHelp(cmd, extra));
      return 0;
    }
    if (positionals.length > (cmd.maxPositionals ?? 0)) {
      throw new CliError(`Unexpected argument: ${positionals[cmd.maxPositionals ?? 0]}`, [
        `Run \`${cmd.name ? `quiz-me ${cmd.name}` : "quiz-me"} --help\` for usage`,
      ]);
    }
    const doc = await cmd.run({
      env: process.env,
      cwd: process.cwd(),
      flags,
      positionals,
      readStdin,
      log: (msg) => process.stderr.write(`quiz-me: ${msg}\n`),
    });
    process.stdout.write(doc instanceof RawOutput ? doc.text : encode(doc));
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      process.stdout.write(renderError(err));
      return err.exitCode;
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(renderError(new CliError(`Internal error: ${message}`)));
    if (process.env.QUIZ_ME_DEBUG && err instanceof Error) process.stderr.write(`${err.stack}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
