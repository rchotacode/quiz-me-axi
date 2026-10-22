import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { CLI, Sandbox, field } from "./helpers.ts";

const COMMANDS: string[][] = [[], ["ask"], ["answers"], ["stop"], ["skill"]];

let sb: Sandbox;
beforeEach(async () => {
  sb = await Sandbox.create();
});
afterEach(async () => {
  await sb.cleanup();
});

describe("AXI conventions", () => {
  it.each(COMMANDS.map((c) => [c.join(" ") || "(bare)", c]))(
    "unknown flag on %s exits 2 with a structured error naming the flag",
    async (_name, cmd) => {
      const r = await sb.run([...cmd, "--bogus-flag"]);
      expect(r.code).toBe(2);
      expect(r.stdout).toMatch(/^error: .*--bogus-flag/m);
      expect(r.stdout).toMatch(/^help\[\d+\]:/m);
      expect(r.stderr).toBe("");
    },
  );

  it("unknown command exits 1 with a structured error", async () => {
    const r = await sb.run(["frobnicate"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^error: .*frobnicate/m);
    expect(r.stdout).toContain("quiz-me --help");
    expect(r.stderr).toBe("");
  });

  it.each(COMMANDS.map((c) => [c.join(" ") || "(bare)", c]))(
    "--help on %s exits 0 and is concise",
    async (_name, cmd) => {
      const r = await sb.run([...cmd, "--help"]);
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/^usage: quiz-me/m);
      expect(r.stdout.split("\n").length).toBeLessThan(25);
      expect(r.stderr).toBe("");
    },
  );

  it("bare quiz-me with an empty state dir shows the home view with an explicit empty state", async () => {
    const r = await sb.run([]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(field(r.stdout, "bin")).toMatch(/^(~|\/)/);
    expect(field(r.stdout, "description")).toMatch(/Questions/);
    expect(field(r.stdout, "quizzes")).toBe("none yet");
    expect(r.stdout).toMatch(/^help\[\d+\]:\n  Run `quiz-me ask/m);
  });

  it("home view shows the executable path with the home directory as ~", async () => {
    const home = homedir();
    expect(CLI.startsWith(home + "/")).toBe(true);
    const r = await sb.run([], { env: { HOME: home } });
    expect(field(r.stdout, "bin")).toBe("~" + CLI.slice(home.length));
  });
});
