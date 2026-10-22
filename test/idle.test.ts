import { describe, expect, it } from "vitest";
import { IdleMonitor, idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS } from "../src/idle.ts";

function monitor(timeoutMs: number) {
  let now = 0;
  let pending = false;
  let fired = 0;
  const m = new IdleMonitor({ timeoutMs, hasPending: () => pending, onIdle: () => fired++, now: () => now });
  return {
    m,
    advance(ms: number) {
      now += ms;
      m.tick();
    },
    setPending(p: boolean) {
      pending = p;
    },
    get fired() {
      return fired;
    },
  };
}

describe("IdleMonitor", () => {
  it("fires once the server has had no pending Quizzes for the timeout", () => {
    const t = monitor(1000);
    t.advance(999);
    expect(t.fired).toBe(0);
    t.advance(1);
    expect(t.fired).toBe(1);
    t.advance(5000);
    expect(t.fired).toBe(1);
  });

  it("never runs while a Quiz is pending, and restarts from zero when none are", () => {
    const t = monitor(1000);
    t.setPending(true);
    t.advance(10_000);
    expect(t.fired).toBe(0);
    t.setPending(false);
    t.advance(500); // the clock starts here
    t.advance(499);
    expect(t.fired).toBe(0);
    t.advance(501);
    expect(t.fired).toBe(1);
  });

  it("activity (e.g. a new ask probing the server) resets the timer", () => {
    const t = monitor(1000);
    t.advance(900);
    t.m.activity();
    t.advance(900);
    expect(t.fired).toBe(0);
    t.advance(100);
    expect(t.fired).toBe(1);
  });
});

describe("idleTimeoutMs", () => {
  it("defaults to 30 minutes", () => {
    expect(DEFAULT_IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000);
    expect(idleTimeoutMs({})).toBe(DEFAULT_IDLE_TIMEOUT_MS);
  });
  it("honours QUIZ_ME_IDLE_TIMEOUT_MS and ignores invalid values", () => {
    expect(idleTimeoutMs({ QUIZ_ME_IDLE_TIMEOUT_MS: "250" })).toBe(250);
    for (const bad of ["", "abc", "0", "-5", "1.5"]) expect(idleTimeoutMs({ QUIZ_ME_IDLE_TIMEOUT_MS: bad })).toBe(DEFAULT_IDLE_TIMEOUT_MS);
  });
});
