import { homedir } from "node:os";
import { join } from "node:path";

/** `$XDG_STATE_HOME/quiz-me`, falling back to `~/.local/state/quiz-me`. */
export function stateDir(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_STATE_HOME && env.XDG_STATE_HOME.startsWith("/") ? env.XDG_STATE_HOME : join(homeDir(env), ".local", "state");
  return join(base, "quiz-me");
}

export function homeDir(env: NodeJS.ProcessEnv): string {
  return env.HOME || homedir();
}

/** Abbreviate the home directory to `~`. */
export function tildify(path: string, env: NodeJS.ProcessEnv): string {
  const home = homeDir(env).replace(/\/+$/, "");
  if (home && (path === home || path.startsWith(home + "/"))) return "~" + path.slice(home.length);
  return path;
}
