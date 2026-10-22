import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Sandbox, field } from "./helpers.ts";

let sb: Sandbox;
beforeEach(async () => {
  sb = await Sandbox.create();
});
afterEach(async () => {
  await sb.cleanup();
});

async function printed(): Promise<string> {
  const r = await sb.run(["skill"]);
  expect(r.code, r.stdout).toBe(0);
  expect(r.stderr).toBe("");
  return r.stdout;
}

function frontmatter(md: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) throw new Error("no frontmatter");
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = /^([a-z][a-z-]*): (.+)$/.exec(line);
    if (!kv) throw new Error(`bad frontmatter line: ${line}`);
    out[kv[1]!] = kv[2]!;
  }
  return out;
}

describe("quiz-me skill", () => {
  it("prints a SKILL.md with valid skill frontmatter", async () => {
    const md = await printed();
    const fm = frontmatter(md);
    expect(Object.keys(fm).sort()).toEqual(["description", "name"]);
    expect(fm.name).toBe("quiz-me");
    expect(fm.name).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(fm.description!.length).toBeGreaterThan(20);
    expect(fm.description!.length).toBeLessThanOrEqual(1024);
    expect(fm.description).not.toMatch(/[<>]/);
    // A YAML plain scalar: no leading indicator, no ": " or " #" that would change its meaning.
    expect(fm.description).not.toMatch(/^[-?:,[\]{}#&*!|>'"%@`]|: | #/);
    expect(md.slice(md.indexOf("\n---\n") + 5).trim()).toMatch(/^# /);
  });

  it("--install writes ./.claude/skills/quiz-me/SKILL.md, creating directories", async () => {
    const r = await sb.run(["skill", "--install"]);
    expect(r.code, r.stdout).toBe(0);
    expect(r.stderr).toBe("");
    const path = join(sb.root, ".claude", "skills", "quiz-me", "SKILL.md");
    expect(existsSync(path)).toBe(true);
    expect(field(r.stdout, "installed")).toBe(path);
    expect(readFileSync(path, "utf8")).toBe(await printed());
  });

  it("--install twice yields identical content, overwriting edits", async () => {
    const path = join(sb.root, ".claude", "skills", "quiz-me", "SKILL.md");
    await sb.run(["skill", "--install"]);
    const first = readFileSync(path, "utf8");
    writeFileSync(path, "stale edits\n");
    const again = await sb.run(["skill", "--install"]);
    expect(again.code).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(first);
  });

  it("--install installs relative to the current directory", async () => {
    const sub = join(sb.root, "project");
    mkdirSync(sub);
    await sb.run(["skill", "--install"], { cwd: sub });
    expect(existsSync(join(sub, ".claude", "skills", "quiz-me", "SKILL.md"))).toBe(true);
  });

  it("every command and flag SKILL.md mentions exists in the real --help output", async () => {
    const md = await printed();
    const home = await sb.run(["--help"]);
    const lines = home.stdout.split("\n");
    const start = lines.findIndex((l) => /^commands\[\d+\]:$/.test(l));
    const listed = lines
      .slice(start + 1, start + 1 + Number(/\d+/.exec(lines[start]!)![0]))
      .map((l) => l.trim().split(/\s+/)[0]!);
    expect(listed).toEqual(["ask", "answers", "stop", "skill"]);

    // Code from inline spans and fenced blocks: that's where SKILL.md names commands and flags.
    const code = [...md.matchAll(/```[^\n]*\n([\s\S]*?)```|`([^`\n]+)`/g)].map((m) => m[1] ?? m[2]!);
    const invocations = code.flatMap((c) => [...c.matchAll(/(?:^|[\s(|;&])quiz-me((?:[ \t]+[^\s|;&)]+)*)/gm)].map((m) => m[1]!.trim().split(/\s+/).filter(Boolean)));
    expect(invocations.length).toBeGreaterThan(4);

    const helpCache = new Map<string, string>();
    const helpFor = async (cmd: string) => {
      if (!helpCache.has(cmd)) {
        const r = await sb.run(cmd ? [cmd, "--help"] : ["--help"]);
        expect(r.code, `quiz-me ${cmd} --help`).toBe(0);
        expect(r.stdout).toMatch(new RegExp(`^usage: quiz-me${cmd ? ` ${cmd}` : ""}\\b`, "m"));
        helpCache.set(cmd, r.stdout);
      }
      return helpCache.get(cmd)!;
    };

    const seenCommands = new Set<string>();
    const seenFlags = new Set<string>();
    for (const tokens of invocations) {
      const cmd = tokens[0] && /^[a-z]+$/.test(tokens[0]) ? tokens[0] : "";
      if (cmd) expect(listed, `command ${cmd}`).toContain(cmd);
      seenCommands.add(cmd);
      const help = await helpFor(cmd);
      const flagLines = help.split("\n").filter((l) => /^ {2}--/.test(l)).map((l) => l.trim().split(/\s+/)[0]);
      for (const t of tokens) {
        const flag = /^(--[a-z-]+)/.exec(t)?.[1];
        if (!flag) continue;
        expect(flagLines, `quiz-me ${cmd} ${flag}`).toContain(flag);
        seenFlags.add(flag);
      }
    }

    // Any flag named anywhere (even in prose) belongs to some command.
    const allHelp = (await Promise.all(["", ...listed].map(helpFor))).join("\n");
    for (const m of md.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)) expect(allHelp, m[0]).toContain(`  ${m[0]}`);

    // The guide covers the whole agent loop.
    for (const cmd of ["ask", "answers", "stop"]) expect(seenCommands).toContain(cmd);
    for (const flag of ["--file", "--no-open", "--port"]) expect(seenFlags).toContain(flag);
  });

  it("is listed in the top-level --help and has its own concise --help", async () => {
    const top = await sb.run(["--help"]);
    expect(top.stdout).toMatch(/^ {2}skill\s/m);
    expect(top.stdout).toMatch(/^ {2}stop\s/m);
    const r = await sb.run(["skill", "--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^usage: quiz-me skill/m);
    expect(r.stdout).toContain("--install");
    expect(r.stdout.split("\n").length).toBeLessThan(25);
  });

  it("rejects unknown flags with exit 2", async () => {
    const r = await sb.run(["skill", "--bogus-flag"]);
    expect(r.code).toBe(2);
  });
});
