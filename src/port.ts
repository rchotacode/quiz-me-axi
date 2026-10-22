import { CliError, type FlagSpec } from "./command.ts";

export const DEFAULT_PORT = 6767;

export const PORT_FLAG: FlagSpec = {
  name: "port",
  value: "<n>",
  description: `Server port (default ${DEFAULT_PORT}, or $QUIZ_ME_PORT)`,
};

/** The server port: `--port` wins over `QUIZ_ME_PORT`, which wins over 6767. Invalid values are a CliError. */
export function resolvePort(flag: string | true | undefined, env: NodeJS.ProcessEnv): number {
  if (typeof flag === "string") return parsePort(flag, "--port");
  if (env.QUIZ_ME_PORT !== undefined && env.QUIZ_ME_PORT !== "") return parsePort(env.QUIZ_ME_PORT, "QUIZ_ME_PORT");
  return DEFAULT_PORT;
}

function parsePort(raw: string, source: string): number {
  const n = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (Number.isInteger(n) && n >= 1 && n <= 65535) return n;
  throw new CliError(`Invalid port ${JSON.stringify(raw)} from ${source}: must be an integer from 1 to 65535`, [
    source === "--port" ? "Run with `--port <n>` where <n> is 1-65535" : "Set QUIZ_ME_PORT to 1-65535, or unset it to use 6767",
  ]);
}
