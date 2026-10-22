import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openerCommand } from "../src/opener.ts";
import { Sandbox, field, waitFor } from "./helpers.ts";

const QUIZ = { questions: [{ title: "One?" }] };

describe("openerCommand", () => {
  const url = "http://localhost:6767/q/abc123";
  it("uses QUIZ_ME_OPENER when set", () => {
    expect(openerCommand(url, { QUIZ_ME_OPENER: "/bin/fake" }, "linux")).toEqual({ cmd: "/bin/fake", args: [url] });
  });
  it.each([
    ["linux", { cmd: "xdg-open", args: [url] }],
    ["freebsd", { cmd: "xdg-open", args: [url] }],
    ["darwin", { cmd: "open", args: [url] }],
    ["win32", { cmd: "cmd", args: ["/c", "start", '""', url] }],
  ] as const)("uses the platform opener on %s", (platform, expected) => {
    expect(openerCommand(url, {}, platform)).toEqual(expected);
  });
});

let sb: Sandbox;
beforeEach(async () => {
  sb = await Sandbox.create();
});
afterEach(async () => {
  await sb.cleanup();
});

describe("ask opens the browser", () => {
  it("passes the Quiz url to the opener", async () => {
    const r = await sb.run(["ask"], { input: JSON.stringify(QUIZ) });
    expect(r.code, r.stdout).toBe(0);
    expect(r.stderr).toBe("");
    const url = field(r.stdout, "url")!;
    expect(field(r.stdout, "browser")).toBe("opened");
    await waitFor(() => existsSync(sb.openerLog));
    expect(readFileSync(sb.openerLog, "utf8")).toBe(`${url}\n`);
  });

  it("--no-open never calls the opener", async () => {
    const r = await sb.ask(QUIZ);
    expect(r.code).toBe(0);
    expect(field(r.stdout, "browser")).toBe("not opened (--no-open)");
    await new Promise((res) => setTimeout(res, 300));
    expect(existsSync(sb.openerLog)).toBe(false);
  });

  it("a missing opener doesn't fail ask: exit 0, url printed, failure logged to stderr", async () => {
    const r = await sb.run(["ask"], { input: JSON.stringify(QUIZ), env: { QUIZ_ME_OPENER: join(sb.root, "no-such-opener") } });
    expect(r.code, r.stdout).toBe(0);
    expect(field(r.stdout, "url")).toMatch(/^http:\/\/localhost:\d+\/q\/[a-z0-9]{6}$/);
    expect(field(r.stdout, "browser")).toMatch(/^failed/);
    expect(r.stdout).toMatch(/Tell the user to open the url/);
    expect(r.stderr).toMatch(/^quiz-me: could not open the browser/m);
  });

  it("an opener that exits non-zero doesn't fail ask, and its own output stays off stdout", async () => {
    const bad = join(sb.root, "bad-opener.sh");
    writeFileSync(bad, "#!/bin/sh\necho 'opener stdout noise'\necho 'no display' >&2\nexit 3\n");
    chmodSync(bad, 0o755);
    const r = await sb.run(["ask"], { input: JSON.stringify(QUIZ), env: { QUIZ_ME_OPENER: bad } });
    expect(r.code).toBe(0);
    expect(field(r.stdout, "url")).toBeTruthy();
    expect(r.stdout).not.toContain("noise");
    expect(field(r.stdout, "browser")).toMatch(/^failed/);
    expect(r.stderr).toMatch(/could not open the browser: .*exited with code 3/);
  });
});
