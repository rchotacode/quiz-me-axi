/**
 * Minimal TOON encoder for AXI output.
 *
 * A document is an ordered set of top-level keys. Values are scalars (`key: value`),
 * string lists (`key[n]:` + one indented line per item) or tables
 * (`key[n]{f1,f2}:` + one indented, comma-delimited row per item).
 */

export type Scalar = string | number | boolean | null;

export type Table = {
  readonly kind: "table";
  fields: string[];
  rows: Scalar[][];
  /** Free-text columns whose non-empty values are always quoted, so their boundaries are unmistakable. */
  alwaysQuote: string[];
};

export type Value = Scalar | readonly string[] | Table;

export type Doc = Record<string, Value | undefined>;

export function table(fields: string[], rows: Scalar[][], opts: { alwaysQuote?: string[] } = {}): Table {
  return { kind: "table", fields, rows, alwaysQuote: opts.alwaysQuote ?? [] };
}

const LOOKS_LIKE_LITERAL = /^(true|false|null|-?\d+(\.\d+)?([eE][+-]?\d+)?)$/;

function escape(s: string): string {
  let out = "";
  for (const ch of s) {
    switch (ch) {
      case "\\": out += "\\\\"; break;
      case '"': out += '\\"'; break;
      case "\n": out += "\\n"; break;
      case "\r": out += "\\r"; break;
      case "\t": out += "\\t"; break;
      default: {
        const code = ch.codePointAt(0)!;
        out += code < 0x20 || code === 0x7f ? `\\u${code.toString(16).padStart(4, "0")}` : ch;
      }
    }
  }
  return `"${out}"`;
}

/** A string needs quoting if it can't be read back verbatim from its line/cell. */
function needsQuotes(s: string, inCell: boolean): boolean {
  if (s === "") return !inCell;
  if (s !== s.trim()) return true;
  if (/[\u0000-\u001f\u007f]/.test(s)) return true;
  // On a line, only a leading quote is ambiguous; in a cell, any quote or backslash is.
  if (s.startsWith('"')) return true;
  if (inCell && /["\\]/.test(s)) return true;
  if (LOOKS_LIKE_LITERAL.test(s)) return true;
  if (inCell && s.includes(",")) return true;
  return false;
}

function scalar(v: Scalar, inCell: boolean): string {
  if (v === null) return "null";
  if (typeof v !== "string") return String(v);
  return needsQuotes(v, inCell) ? escape(v) : v;
}

export function encode(doc: Doc): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(doc)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}[${value.length}]:`);
      for (const item of value) lines.push(`  ${scalar(item, false)}`);
    } else if (value !== null && typeof value === "object") {
      const t = value as Table;
      lines.push(`${key}[${t.rows.length}]{${t.fields.join(",")}}:`);
      const forced = t.fields.map((f) => t.alwaysQuote.includes(f));
      for (const row of t.rows) {
        const cells = row.map((c, i) =>
          forced[i] && typeof c === "string" && c !== "" ? escape(c) : scalar(c, true),
        );
        lines.push(`  ${cells.join(",")}`);
      }
    } else {
      lines.push(`${key}: ${scalar(value as Scalar, false)}`);
    }
  }
  return lines.join("\n") + "\n";
}
