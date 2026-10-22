import { encode, type Doc } from "./toon.ts";

/** A failure reported to the agent as structured TOON on stdout. */
export class CliError extends Error {
  readonly help: string[];
  readonly exitCode: number;
  constructor(message: string, help: string[] = [], exitCode = 1) {
    super(message);
    this.help = help;
    this.exitCode = exitCode;
  }
}

/** Output written to stdout verbatim instead of as TOON (e.g. the SKILL.md document). */
export class RawOutput {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
}

export type FlagSpec = {
  name: string; // without the leading dashes
  value?: string; // placeholder if the flag takes a value, e.g. "<path>"
  description: string;
};

export type Context = {
  env: NodeJS.ProcessEnv;
  cwd: string;
  flags: Record<string, string | true>;
  positionals: string[];
  readStdin: () => Promise<string>;
  /** Write a line to stderr. Logs only; never data. */
  log: (msg: string) => void;
};

export type Command = {
  name: string; // "" for the bare command
  usage: string;
  description: string;
  flags: FlagSpec[];
  /** Extra fields shown in `--help`. */
  helpExtra?: Doc;
  /** Max positional arguments accepted. */
  maxPositionals?: number;
  run: (ctx: Context) => Promise<Doc | RawOutput> | Doc | RawOutput;
};

const HELP_FLAG: FlagSpec = { name: "help", description: "Show this help" };

export function commandLabel(cmd: Command): string {
  return cmd.name ? `quiz-me ${cmd.name}` : "quiz-me";
}

export function parseArgs(cmd: Command, argv: string[]): { flags: Record<string, string | true>; positionals: string[] } {
  const specs = [...cmd.flags, HELP_FLAG];
  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];
  const helpHint = `Run \`${commandLabel(cmd)} --help\` to see available flags`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg.startsWith("-") && arg !== "-") {
      const eq = arg.indexOf("=");
      const name = (eq === -1 ? arg : arg.slice(0, eq)).replace(/^--?/, "");
      const spec = arg.startsWith("--") ? specs.find((s) => s.name === name) : undefined;
      if (!spec) throw new CliError(`Unknown flag: ${eq === -1 ? arg : arg.slice(0, eq)}`, [helpHint], 2);
      if (spec.value) {
        const v = eq !== -1 ? arg.slice(eq + 1) : argv[++i];
        if (v === undefined) throw new CliError(`Flag --${name} needs a value ${spec.value}`, [helpHint]);
        flags[name] = v;
      } else {
        if (eq !== -1) throw new CliError(`Flag --${name} does not take a value`, [helpHint]);
        flags[name] = true;
      }
      continue;
    }
    positionals.push(arg);
  }
  return { flags, positionals };
}

export function renderHelp(cmd: Command, extra: Doc = {}): string {
  const flags = [...cmd.flags, HELP_FLAG];
  const width = Math.max(...flags.map((f) => flagText(f).length));
  return encode({
    usage: cmd.usage,
    description: cmd.description,
    ...cmd.helpExtra,
    ...extra,
    flags: flags.map((f) => `${flagText(f).padEnd(width)}  ${f.description}`),
  });
}

function flagText(f: FlagSpec): string {
  return f.value ? `--${f.name} ${f.value}` : `--${f.name}`;
}

export function renderError(err: CliError): string {
  return encode({ error: err.message, help: err.help.length ? err.help : undefined });
}
