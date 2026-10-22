import { spawn } from "node:child_process";

/** If the opener hasn't failed within this long, assume it worked (some openers stay attached to the browser). */
const GRACE_MS = 500;

export type OpenerCommand = { cmd: string; args: string[] };

/** `QUIZ_ME_OPENER <url>` if set (tests use a stub), else the platform's opener. */
export function openerCommand(url: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): OpenerCommand {
  if (env.QUIZ_ME_OPENER) return { cmd: env.QUIZ_ME_OPENER, args: [url] };
  if (platform === "darwin") return { cmd: "open", args: [url] };
  // `start`'s first quoted argument is a window title, so pass an empty one.
  if (platform === "win32") return { cmd: "cmd", args: ["/c", "start", '""', url] };
  return { cmd: "xdg-open", args: [url] };
}

/**
 * Open `url` in the default browser, detached. Never throws: resolves to an error message
 * if the opener couldn't be started or exited non-zero within a short grace period.
 */
export function openUrl(url: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  const { cmd, args } = openerCommand(url, env, platform);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
        env,
        windowsVerbatimArguments: platform === "win32",
      });
    } catch (err) {
      return resolve(`${cmd}: ${(err as Error).message}`);
    }
    const timer = setTimeout(() => {
      child.removeAllListeners();
      child.unref();
      resolve(undefined);
    }, GRACE_MS);
    timer.unref();
    child.once("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve(`${cmd}: ${err.code === "ENOENT" ? "command not found" : err.message}`);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(undefined);
      else resolve(`${cmd} exited ${signal ? `on signal ${signal}` : `with code ${code}`}`);
    });
  });
}
