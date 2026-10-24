/**
 * Copy highlight.js's core and the languages quiz-me loads (plus its licence) into
 * dist/vendor/highlight.js/, so the built package highlights code offline without shipping
 * the full highlight.js package. Run by `npm run build` after tsc.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { HIGHLIGHT_LANGUAGES } from "../src/highlight.ts";

const pkg = dirname(createRequire(import.meta.url).resolve("highlight.js/package.json"));
const out = resolve(import.meta.dirname, "../dist/vendor/highlight.js");
mkdirSync(join(out, "languages"), { recursive: true });
copyFileSync(join(pkg, "LICENSE"), join(out, "LICENSE"));
copyFileSync(join(pkg, "lib/core.js"), join(out, "core.cjs"));
for (const name of HIGHLIGHT_LANGUAGES) {
  copyFileSync(join(pkg, `lib/languages/${name}.js`), join(out, `languages/${name}.cjs`));
}
