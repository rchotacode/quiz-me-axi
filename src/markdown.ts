/**
 * A small, safe Markdown renderer for Question bodies.
 *
 * Everything is HTML-escaped first; only the constructs below produce markup:
 * fenced code blocks, headings, lists, blockquotes, rules, paragraphs, and inline
 * code, bold, italic and http(s)/mailto links. Raw HTML is never passed through.
 * Fenced code blocks whose language is known are syntax-highlighted (see highlight.ts).
 */
import { highlight } from "./highlight.ts";
import { escapeHtml } from "./html.ts";

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function inline(text: string): string {
  // Split out code spans first so nothing inside them is formatted.
  return text
    .split(/(`+)([\s\S]*?[^`])\1(?!`)/)
    .map((part, i) => {
      if (i % 3 === 1) return ""; // the backtick run itself
      if (i % 3 === 2) return `<code>${escapeHtml(part)}</code>`;
      return emphasis(part);
    })
    .join("");
}

function emphasis(raw: string): string {
  let s = escapeHtml(raw);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_whole, label: string, url: string) => {
    const decoded = url.replace(/&amp;/g, "&");
    if (!SAFE_URL.test(decoded)) return label;
    return `<a href="${url}" rel="noreferrer noopener" target="_blank">${label}</a>`;
  });
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(?=\S)([\s\S]*?\S)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*(?=\S)([\s\S]*?\S)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, "$1<em>$2</em>");
  return s;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** A language tag we'll put in a class attribute; anything else in the info string is ignored. */
const LANGUAGE = /^[\w+#.-]+$/;

function openingFence(line: string): RegExpExecArray | undefined {
  const m = FENCE.exec(line);
  // A backtick fence's info string can't contain backticks (CommonMark), so ```a``` stays inline code.
  return m && !(m[1]!.startsWith("`") && m[2]!.includes("`")) ? m : undefined;
}

function codeBlock(code: string, info: string): string {
  const lang = info.trim().split(/\s+/)[0]!;
  if (!LANGUAGE.test(lang)) return `<pre><code>${escapeHtml(code)}</code></pre>`;
  const highlighted = highlight(code, lang);
  if (highlighted === undefined) return `<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>`;
  return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
}
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const UL_ITEM = /^ {0,3}[-*+]\s+(.*)$/;
const OL_ITEM = /^ {0,3}\d{1,9}[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = openingFence(line);
    if (fence) {
      const close = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(close)) body.push(lines[i++]!);
      i++; // closing fence (or end of input)
      out.push(codeBlock(body.join("\n"), fence[2]!));
      continue;
    }
    if (RULE.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      // The card title is an <h2>, so body headings start one level below it.
      const level = Math.min(heading[1]!.length + 1, 6);
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) body.push(QUOTE.exec(lines[i++]!)![1]!);
      out.push(`<blockquote>${renderMarkdown(body.join("\n"))}</blockquote>`);
      continue;
    }
    const list = UL_ITEM.test(line) ? { re: UL_ITEM, tag: "ul" } : OL_ITEM.test(line) ? { re: OL_ITEM, tag: "ol" } : undefined;
    if (list) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = list.re.exec(lines[i]!);
        const continuation = !m && items.length > 0 && /^\s+\S/.test(lines[i]!);
        if (m) items.push(m[1]!);
        else if (continuation) items[items.length - 1] += "\n" + lines[i]!.trim();
        else break;
        i++;
      }
      out.push(`<${list.tag}>\n${items.map((it) => `<li>${inline(it)}</li>`).join("\n")}\n</${list.tag}>`);
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !openingFence(lines[i]!) &&
      !HEADING.test(lines[i]!) &&
      !QUOTE.test(lines[i]!) &&
      !UL_ITEM.test(lines[i]!) &&
      !OL_ITEM.test(lines[i]!) &&
      !RULE.test(lines[i]!)
    ) {
      para.push(lines[i++]!.trim());
    }
    out.push(`<p>${inline(para.join("\n"))}</p>`);
  }
  return out.join("\n");
}
