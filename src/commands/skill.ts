import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliError, RawOutput, type Command } from "../command.ts";
import { tildify } from "../paths.ts";
import { SKILL_MD } from "../skill.ts";

export const SKILL_PATH = join(".claude", "skills", "quiz-me", "SKILL.md");

export const skillCommand: Command = {
  name: "skill",
  usage: "quiz-me skill [--install]",
  description: "Print the agent guide (SKILL.md), or install it into this project",
  flags: [{ name: "install", description: `Write it to ./${SKILL_PATH}, overwriting any existing copy` }],
  run(ctx) {
    if (!ctx.flags.install) return new RawOutput(SKILL_MD);
    const path = join(ctx.cwd, SKILL_PATH);
    try {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, SKILL_MD);
    } catch (err) {
      throw new CliError(`Cannot write ${path}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`, [
        "Run `quiz-me skill` and save its output yourself",
      ]);
    }
    return {
      installed: tildify(path, ctx.env),
      help: ["Run `quiz-me skill --install` again after upgrading quiz-me to refresh it"],
    };
  },
};
