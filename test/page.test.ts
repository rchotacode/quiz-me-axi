import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Sandbox, field, submit } from "./helpers.ts";

const APP_JS = readFileSync(resolve(import.meta.dirname, "../src/web/app.js"), "utf8");

let sb: Sandbox;
let windows: Window[] = [];
beforeEach(async () => {
  sb = await Sandbox.create();
});
afterEach(async () => {
  for (const w of windows) await w.happyDOM.close();
  windows = [];
  await sb.cleanup();
});

async function ask(quiz: unknown): Promise<string> {
  const r = await sb.ask(quiz);
  expect(r.code, r.stdout).toBe(0);
  return field(r.stdout, "quiz")!;
}

async function pageHtml(id: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${sb.port}/q/${id}`);
  return res.text();
}

type Posted = { url: string; body: unknown };

/** Load the served page into a DOM and run the real app.js against it, with fetch and reload stubbed. */
async function loadPage(id: string) {
  const window = new Window({
    url: `http://localhost:${sb.port}/q/${id}`,
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  windows.push(window);
  window.document.write(await pageHtml(id));
  const posted: Posted[] = [];
  let reloaded = 0;
  const fakeFetch = async (url: string, init: { body: string }) => {
    posted.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ status: "submitted" }) };
  };
  const fakeLocation = { reload: () => reloaded++ };
  new Function("window", "document", "fetch", "location", APP_JS)(window, window.document, fakeFetch, fakeLocation);
  const doc = window.document;
  const q = (sel: string) => doc.querySelector(sel) as unknown as HTMLElement;
  return {
    doc,
    posted,
    reloaded: () => reloaded,
    progress: () => q("[data-progress]").textContent,
    submitDisabled: () => (q('button[type="submit"]') as HTMLButtonElement).disabled,
    choose: (qid: string, answer: "yes" | "no") => q(`[data-question="${qid}"] [data-answer="${answer}"]`).click(),
    clarify: (qid: string, text: string) => {
      const ta = q(`[data-question="${qid}"] textarea`) as HTMLTextAreaElement;
      ta.value = text;
    },
    submit: async () => {
      q('button[type="submit"]').click();
      await new Promise((r) => setTimeout(r, 20));
    },
  };
}

describe("Quiz page", () => {
  it("renders Question bodies as Markdown with code blocks, lists and inline code", async () => {
    const id = await ask({
      questions: [{ title: "Migrate?", body: "Run `npm ci` first.\n\n- step one\n- step two\n\n```sh\nnpm run migrate\n```" }],
    });
    const html = await pageHtml(id);
    expect(html).toContain("<code>npm ci</code>");
    expect(html).toContain("<li>step one</li>");
    expect(html).toContain('<pre><code class="hljs language-sh">npm run migrate</code></pre>');
  });

  it("escapes HTML and script in the Quiz title, Question title and body", async () => {
    const id = await ask({
      title: "<script>alert('t')</script>",
      questions: [{ title: "<img src=x onerror=alert(1)>", body: "<script>alert(2)</script>" }],
    });
    const html = await pageHtml(id);
    expect(html.match(/<script/g)).toHaveLength(1); // only the page's own app.js
    expect(html).toContain('<script src="/assets/app.js"></script>');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("shows every Question as a card on one page with a progress footer", async () => {
    const id = await ask({ questions: [{ title: "A?" }, { title: "B?" }, { title: "C?" }] });
    const page = await loadPage(id);
    expect(page.doc.querySelectorAll(".card")).toHaveLength(3);
    expect(page.progress()).toBe("0 of 3 answered");
  });

  it("updates the progress count as Answers are chosen and changed", async () => {
    const id = await ask({ questions: [{ title: "A?" }, { title: "B?" }] });
    const page = await loadPage(id);
    page.choose("q1", "yes");
    expect(page.progress()).toBe("1 of 2 answered");
    page.choose("q1", "no");
    expect(page.progress()).toBe("1 of 2 answered");
    page.choose("q2", "no");
    expect(page.progress()).toBe("2 of 2 answered");
  });

  it("keeps Submit disabled until every Question has an Answer, then submits them all", async () => {
    const id = await ask({ questions: [{ title: "A?" }, { title: "B?" }] });
    const page = await loadPage(id);
    expect(page.submitDisabled()).toBe(true);
    page.choose("q1", "yes");
    expect(page.submitDisabled()).toBe(true);
    page.choose("q2", "no");
    expect(page.submitDisabled()).toBe(false);
    page.clarify("q2", "Not yet, see #12");
    await page.submit();
    expect(page.posted).toEqual([
      {
        url: `/api/quizzes/${id}/submission`,
        body: { answers: [{ id: "q1", answer: "yes", clarification: "" }, { id: "q2", answer: "no", clarification: "Not yet, see #12" }] },
      },
    ]);
    expect(page.reloaded()).toBe(1);
  });

  it("shows a read-only Submitted view with no editable controls once the Quiz is submitted", async () => {
    const id = await ask({ questions: [{ title: "A?" }, { title: "B?", body: "Some `code`" }] });
    await submit(sb.port, id, [
      { id: "q1", answer: "yes" },
      { id: "q2", answer: "no", clarification: "Because <reasons>" },
    ]);
    const html = await pageHtml(id);
    expect(html).toContain("Submitted — return to your agent");
    expect(html).not.toMatch(/<(button|textarea|input|select|form)\b/);
    expect(html).toContain("Because &lt;reasons&gt;");
    expect(html).toContain("<code>code</code>");
  });

  it("follows the system light/dark preference", async () => {
    const id = await ask({ questions: [{ title: "A?" }] });
    const css = await (await fetch(`http://127.0.0.1:${sb.port}/assets/style.css`)).text();
    expect(css).toContain("prefers-color-scheme: dark");
    expect(await pageHtml(id)).toContain('<meta name="color-scheme" content="light dark">');
  });

  it("syntax-highlights fenced code server-side, with no extra script and a strict CSP", async () => {
    const id = await ask({ questions: [{ title: "OK?", body: "```ts\nconst x = 1;\n```\n\n```\n<script>alert(1)</script>\n```" }] });
    const res = await fetch(`http://127.0.0.1:${sb.port}/q/${id}`);
    const html = await res.text();
    expect(html).toContain('<code class="hljs language-ts"><span class="hljs-keyword">const</span> x = <span class="hljs-number">1</span>;</code>');
    expect(html).toContain("<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>");
    expect(html.match(/<script/g)).toHaveLength(1); // only the page's own app.js
    expect(html).not.toMatch(/\sstyle=/);
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    );
  });
});

/** The declarations of every rule whose selector list includes `selector` (outside or inside at-rules). */
function rule(css: string, selector: string): string {
  const found: string[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(",").some((s) => s.trim() === selector)) found.push(m[2]!);
  }
  expect(found.length, `no rule for ${selector}`).toBeGreaterThan(0);
  return found.join(";");
}

function darkBlock(css: string): string {
  const start = css.indexOf("@media (prefers-color-scheme: dark)");
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error("unterminated dark block");
}

describe("Quiz page stylesheet", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../src/web/style.css"), "utf8");

  it("sizes the page column to the window, with a side gutter and a reading max-width", () => {
    const main = rule(css, "main");
    expect(main).toMatch(/max-width:\s*var\(--page-max\)/);
    expect(main).toMatch(/padding:[^;]*var\(--gutter\)/);
    expect(rule(css, ":root")).toMatch(/--page-max:\s*\d+(\.\d+)?rem/);
    expect(rule(css, ":root")).toMatch(/--gutter:\s*clamp\(/);
    // Nothing on the page pins a pixel width that could force horizontal scrolling on a phone.
    expect(css).not.toMatch(/(^|[^-])width:\s*\d{3,}px/m);
  });

  it("keeps cards within the column so wide content can't stretch them", () => {
    expect(rule(css, ".card")).toMatch(/min-width:\s*0/);
    expect(rule(css, ".body")).toMatch(/min-width:\s*0/);
  });

  it("scrolls code blocks horizontally inside the card instead of wrapping or stretching it", () => {
    const pre = rule(css, ".body pre");
    expect(pre).toMatch(/overflow-x:\s*auto/);
    expect(pre).toMatch(/max-width:\s*100%/);
    expect(rule(css, "pre code")).toMatch(/white-space:\s*pre(;|$|\s)/);
  });

  it("lines the sticky footer up with the page column", () => {
    expect(rule(css, ".bar")).toMatch(/var\(--page-max\)/);
  });

  it("colours highlighted code in both light and dark themes", () => {
    for (const token of [".hljs-keyword", ".hljs-string", ".hljs-comment", ".hljs-number", ".hljs-title", ".hljs-addition", ".hljs-deletion"]) {
      expect(rule(css, token)).toMatch(/color:\s*var\(--hl-/);
    }
    const lightVars = [...rule(css, ":root").matchAll(/(--hl-[\w-]+):/g)].map((m) => m[1]);
    expect(lightVars.length).toBeGreaterThan(4);
    const dark = darkBlock(css);
    for (const v of lightVars) expect(dark).toContain(`${v}:`);
  });
});
