import { describe, expect, it } from "vitest";
import { encode, table } from "../src/toon.ts";

describe("TOON encoding", () => {
  it("encodes plain key/value pairs unquoted", () => {
    expect(encode({ quiz: "abc123", count: 3, open: true, title: "Use Postgres?" })).toBe(
      "quiz: abc123\ncount: 3\nopen: true\ntitle: Use Postgres?\n",
    );
  });

  it("quotes and escapes values containing newlines or control characters", () => {
    expect(encode({ b: "line1\nline2", d: "tab\there" })).toBe('b: "line1\\nline2"\nd: "tab\\there"\n');
  });

  it("leaves inner quotes and backslashes verbatim on a line, but quotes a value that starts with a quote", () => {
    expect(encode({ a: 'say "hi"', c: "back\\slash", e: '"quoted" start' })).toBe(
      'a: say "hi"\nc: back\\slash\ne: "\\"quoted\\" start"\n',
    );
  });

  it("quotes and escapes table cells containing quotes or backslashes", () => {
    expect(encode({ t: table(["a"], [['say "hi"'], ["back\\slash"]]) })).toBe(
      't[2]{a}:\n  "say \\"hi\\""\n  "back\\\\slash"\n',
    );
  });

  it("quotes values with leading/trailing whitespace or that look like other types", () => {
    expect(encode({ a: " padded", b: "true", c: "42", d: "null" })).toBe(
      'a: " padded"\nb: "true"\nc: "42"\nd: "null"\n',
    );
  });

  it("encodes an empty string value as an explicit empty quoted string", () => {
    expect(encode({ title: "" })).toBe('title: ""\n');
  });

  it("encodes tables with a header and one indented row per item", () => {
    const out = encode({
      answers: table(
        ["id", "title", "answer", "clarification"],
        [
          ["q1", "Use Postgres?", "yes", ""],
          ["q2", "Add caching?", "no", "Not until we measure"],
          ["q3", "Ship, Friday?", "yes", 'He said "no"\nthen yes'],
        ],
        { alwaysQuote: ["clarification"] },
      ),
    });
    expect(out).toBe(
      "answers[3]{id,title,answer,clarification}:\n" +
        "  q1,Use Postgres?,yes,\n" +
        '  q2,Add caching?,no,"Not until we measure"\n' +
        '  q3,"Ship, Friday?",yes,"He said \\"no\\"\\nthen yes"\n',
    );
  });

  it("only quotes cells that need it when no column is marked always-quoted", () => {
    expect(encode({ t: table(["a", "b"], [["one two", "x,y"]]) })).toBe('t[1]{a,b}:\n  one two,"x,y"\n');
  });

  it("encodes string lists one item per indented line", () => {
    expect(encode({ help: ["Run `quiz-me answers <id>`", "Run `quiz-me stop`"] })).toBe(
      "help[2]:\n  Run `quiz-me answers <id>`\n  Run `quiz-me stop`\n",
    );
  });
});
