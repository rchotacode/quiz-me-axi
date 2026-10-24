import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/markdown.ts";

describe("Question body Markdown", () => {
  it("renders a fenced code block with no language as plain escaped monospace", () => {
    const html = renderMarkdown("Consider:\n\n```\nconst a = 1 < 2;\nif (a) { go(); }\n```\n");
    expect(html).toBe("<p>Consider:</p>\n" + "<pre><code>const a = 1 &lt; 2;\nif (a) { go(); }</code></pre>");
  });

  it("renders unordered and ordered lists", () => {
    expect(renderMarkdown("- one\n- two\n\n1. first\n2. second")).toBe(
      "<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<ol>\n<li>first</li>\n<li>second</li>\n</ol>",
    );
  });

  it("renders inline code, bold, italic and safe links", () => {
    expect(renderMarkdown("Use `npm ci` **always**, *maybe* [docs](https://example.com/a?b=1&c=2).")).toBe(
      '<p>Use <code>npm ci</code> <strong>always</strong>, <em>maybe</em> <a href="https://example.com/a?b=1&amp;c=2" rel="noreferrer noopener" target="_blank">docs</a>.</p>',
    );
  });

  it("does not format inside inline code", () => {
    expect(renderMarkdown("`**not bold** <b>`")).toBe("<p><code>**not bold** &lt;b&gt;</code></p>");
  });

  it("renders headings and blockquotes", () => {
    expect(renderMarkdown("## Context\n\n> quoted text")).toBe("<h3>Context</h3>\n<blockquote><p>quoted text</p></blockquote>");
  });

  it("escapes raw HTML and script instead of passing it through", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">');
    expect(html).not.toMatch(/<script|<img/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("refuses javascript: links", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('href="javascript');
  });
});

/** Every tag the renderer may emit for a code block; anything else means markup escaped the code block. */
function expectOnlySafeCodeMarkup(html: string): void {
  for (const tag of html.match(/<[^>]*>/g) ?? []) {
    expect(tag).toMatch(/^<(\/?(pre|p|code|span)|code class="(hljs )?language-[\w+#.-]+"|span class="(hljs-|language-)[\w -]+")>$/);
  }
}

/** The text a browser would show for a single rendered code block: tags dropped, entities decoded. */
function codeText(html: string): string {
  const m = /^<pre><code[^>]*>([\s\S]*)<\/code><\/pre>/.exec(html);
  expect(m, html).not.toBeNull();
  return m![1]!
    .replace(/<[^>]*>/g, "")
    .replace(/&(lt|gt|quot|#39|#x27|amp);/g, (_e, n: string) => ({ lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'", amp: "&" })[n]!);
}

const HOSTILE = '<script>alert(1)</script></code></pre><img src=x onerror="alert(2)"><a href="javascript:x">';

describe("Question body syntax highlighting", () => {
  it("highlights a fenced code block using the fence's language tag", () => {
    const html = renderMarkdown("```ts\nconst a: number = 1 < 2 ? 3 : 4;\n```");
    expect(html).toMatch(/^<pre><code class="hljs language-ts">[\s\S]*<\/code><\/pre>$/);
    expect(html).toContain('<span class="hljs-keyword">const</span>');
    expect(html).toContain("&lt;");
    expectOnlySafeCodeMarkup(html);
  });

  it.each([
    ["ts", "interface A { b: string }"],
    ["typescript", "type T = number;"],
    ["js", "function f() { return 1; }"],
    ["javascript", "let x = null;"],
    ["json", '{"a": true}'],
    ["bash", 'if [ -f x ]; then echo "hi"; fi'],
    ["sh", "export FOO=1"],
    ["shell", "export FOO=1"],
    ["python", "def f():\n    return None"],
    ["py", "import os"],
    ["go", "func main() {}"],
    ["rust", "fn main() { let x = 1; }"],
    ["sql", "SELECT * FROM t WHERE a = 1;"],
    ["yaml", "key: true"],
    ["yml", "key: true"],
    ["html", '<div class="x">hi</div>'],
    ["xml", "<a>b</a>"],
    ["css", "body { color: red; }"],
    ["diff", "--- a\n+++ b\n-old\n+new"],
  ])("highlights %s", (lang, code) => {
    const html = renderMarkdown("```" + lang + "\n" + code + "\n```");
    expect(html).toContain(`<code class="hljs language-${lang}">`);
    expect(html).toMatch(/<span class="hljs-/);
    expect(codeText(html)).toBe(code);
    expectOnlySafeCodeMarkup(html);
  });

  it("renders an unknown language as plain escaped monospace without guessing", () => {
    const html = renderMarkdown("```brainfuck\nconst <b>x</b> = 1;\n```");
    expect(html).toBe('<pre><code class="language-brainfuck">const &lt;b&gt;x&lt;/b&gt; = 1;</code></pre>');
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])("treats the language tag %s as unknown", (lang) => {
    const html = renderMarkdown("```" + lang + "\nx < y\n```");
    expect(html).toBe(`<pre><code class="language-${lang}">x &lt; y</code></pre>`);
  });

  it.each(["", "ts", "js", "html", "xml", "bash", "json", "diff", "unknown"])(
    "keeps HTML and script inside a code block escaped (language: %s)",
    (lang) => {
      const html = renderMarkdown("```" + lang + "\n" + HOSTILE + "\n```\n\nafter");
      expect(html).not.toMatch(/<(script|img|a)\b/i);
      expect(html).not.toMatch(/<\/code><\/pre>[\s\S]*<\/code><\/pre>/); // no early break-out
      expect(codeText(html)).toBe(HOSTILE);
      expect(html).toMatch(/<\/code><\/pre>\n<p>after<\/p>$/);
      expectOnlySafeCodeMarkup(html.replace(/\n<p>after<\/p>$/, ""));
    },
  );

  it.each([
    '"><script>alert(1)</script>',
    "ts\"><script>alert(1)</script>",
    'ts" onmouseover="alert(1)',
    "<img src=x onerror=alert(1)>",
    "ts onclick=alert(1)",
  ])("handles a malicious language tag safely: %s", (tag) => {
    const html = renderMarkdown("```" + tag + "\nlet x = 1 < 2;\n```\n\nafter");
    expect(html).not.toMatch(/<(script|img)\b/i);
    expect(html).not.toMatch(/\son\w+=/i);
    expect(html).toMatch(/^<pre><code( class="hljs language-ts")?>/);
    expect(codeText(html)).toBe("let x = 1 < 2;");
    expect(html).toMatch(/<\/code><\/pre>\n<p>after<\/p>$/);
    expectOnlySafeCodeMarkup(html.replace(/\n<p>after<\/p>$/, ""));
  });

  it("takes the language from the first word of the info string", () => {
    const html = renderMarkdown('```ts title="x.ts"\nconst a = 1;\n```');
    expect(html).toContain('<code class="hljs language-ts">');
    expect(html).toContain('<span class="hljs-keyword">const</span>');
  });
});
