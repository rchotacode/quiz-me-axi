import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/markdown.ts";

describe("Question body Markdown", () => {
  it("renders fenced code blocks as monospace pre/code without highlighting markup", () => {
    const html = renderMarkdown("Consider:\n\n```ts\nconst a = 1 < 2;\nif (a) { go(); }\n```\n");
    expect(html).toBe(
      "<p>Consider:</p>\n" + '<pre><code class="language-ts">const a = 1 &lt; 2;\nif (a) { go(); }</code></pre>',
    );
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
