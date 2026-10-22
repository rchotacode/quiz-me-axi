/** The shared server's idle shutdown: it exits after a stretch with no pending Quizzes. */

export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** `QUIZ_ME_IDLE_TIMEOUT_MS` (a positive integer, for tests), else 30 minutes. */
export function idleTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.QUIZ_ME_IDLE_TIMEOUT_MS ?? "";
  return /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : DEFAULT_IDLE_TIMEOUT_MS;
}

export type IdleOptions = {
  timeoutMs: number;
  /** Whether any Quiz is still waiting for a Submission. */
  hasPending: () => boolean;
  onIdle: () => void;
  now?: () => number;
};

/**
 * The idle clock only runs while no Quiz is pending. It starts when the last pending Quiz
 * is submitted (or at startup if none is), and any activity, such as an `ask` probing the
 * server, restarts it. Call `tick()` periodically.
 */
export class IdleMonitor {
  private readonly opts: Required<IdleOptions>;
  private idleSince: number | undefined;
  private fired = false;

  constructor(opts: IdleOptions) {
    this.opts = { now: Date.now, ...opts };
    this.idleSince = this.opts.now();
  }

  activity(): void {
    this.idleSince = this.opts.now();
  }

  tick(): void {
    if (this.fired) return;
    const now = this.opts.now();
    if (this.opts.hasPending()) {
      this.idleSince = undefined;
      return;
    }
    this.idleSince ??= now;
    if (now - this.idleSince >= this.opts.timeoutMs) {
      this.fired = true;
      this.opts.onIdle();
    }
  }

  /** How often to tick: often enough to be accurate to about a tenth of the timeout. */
  get tickMs(): number {
    return Math.min(30_000, Math.max(20, Math.floor(this.opts.timeoutMs / 10)));
  }
}
