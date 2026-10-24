/**
 * Server-side syntax highlighting for fenced code blocks, using highlight.js.
 *
 * Only highlight.js's core and the languages below are loaded. `npm run build` copies exactly
 * these files into `dist/vendor/highlight.js/` (see scripts/vendor-highlight.ts), so the built
 * package works offline without the full highlight.js package; running from source falls back
 * to the pinned devDependency in node_modules.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { HLJSApi, LanguageFn } from "highlight.js";

/** highlight.js language modules to load. Their aliases (ts, js, sh, py, yml, html, ...) come with them. */
export const HIGHLIGHT_LANGUAGES = [
  "bash",
  "css",
  "diff",
  "go",
  "javascript",
  "json",
  "python",
  "rust",
  "sql",
  "typescript",
  "xml",
  "yaml",
] as const;

const VENDORED = fileURLToPath(new URL("./vendor/highlight.js/", import.meta.url));
const require = createRequire(import.meta.url);
/** Load a highlight.js module by its path under `lib/`, e.g. "core" or "languages/go". */
const load: (path: string) => unknown = existsSync(VENDORED)
  ? (path) => require(`${VENDORED}${path}.cjs`) // .cjs: dist is "type": "module"
  : (path) => require(`highlight.js/lib/${path}`);

const hljs = (load("core") as HLJSApi).newInstance();
for (const name of HIGHLIGHT_LANGUAGES) hljs.registerLanguage(name, load(`languages/${name}`) as LanguageFn);
hljs.registerAliases(["shell"], { languageName: "bash" });

/**
 * Highlight `code` as `language`, returning HTML whose text is escaped by highlight.js and whose
 * only markup is `<span class="hljs-...">`. Returns undefined for a language that isn't loaded;
 * there's no auto-detection.
 */
export function highlight(code: string, language: string): string | undefined {
  if (!hljs.getLanguage(language)) return undefined;
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}
