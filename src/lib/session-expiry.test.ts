import { describe, expect, it } from "vitest";
import {
  SESSION_LIMITS,
  formatCountdown,
  idleWarningMsLeft,
  sessionExpiryReason,
} from "@/lib/session-expiry";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const t0 = 1_700_000_000_000;

describe("sessionExpiryReason", () => {
  it("keeps a fresh, active session", () => {
    expect(
      sessionExpiryReason({ signedInAt: t0, lastActiveAt: t0 + 5 * MIN }, t0 + 10 * MIN),
    ).toBeNull();
  });

  it("ends a session idle for 30 minutes", () => {
    expect(sessionExpiryReason({ signedInAt: t0, lastActiveAt: t0 }, t0 + 30 * MIN)).toBe("idle");
    expect(sessionExpiryReason({ signedInAt: t0, lastActiveAt: t0 }, t0 + 29 * MIN)).toBeNull();
  });

  it("ends a session 12 hours after sign-in even when active", () => {
    const now = t0 + 12 * HOUR;
    expect(sessionExpiryReason({ signedInAt: t0, lastActiveAt: now - MIN }, now)).toBe("max");
  });

  it("falls back to the sign-in time when no activity was recorded", () => {
    expect(sessionExpiryReason({ signedInAt: t0, lastActiveAt: null }, t0 + 31 * MIN)).toBe("idle");
  });

  it("ends a session with no recorded sign-in time", () => {
    expect(sessionExpiryReason({ signedInAt: null, lastActiveAt: t0 }, t0)).toBe("unknown");
  });

  it("uses limits of 30 minutes idle and 12 hours total", () => {
    expect(SESSION_LIMITS).toEqual({ idleMs: 30 * MIN, maxMs: 12 * HOUR, warnMs: 2 * MIN });
  });
});

describe("idleWarningMsLeft", () => {
  const SEC = 1000;
  const active = (lastActiveAt: number) => ({ signedInAt: t0, lastActiveAt });

  it("stays quiet until 2 minutes before the idle sign-out", () => {
    expect(idleWarningMsLeft(active(t0), t0)).toBeNull();
    expect(idleWarningMsLeft(active(t0), t0 + 28 * MIN - SEC)).toBeNull();
  });

  it("warns from 28 minutes idle, counting down to the sign-out", () => {
    expect(idleWarningMsLeft(active(t0), t0 + 28 * MIN)).toBe(2 * MIN);
    expect(idleWarningMsLeft(active(t0), t0 + 29 * MIN)).toBe(MIN);
    expect(idleWarningMsLeft(active(t0), t0 + 30 * MIN - SEC)).toBe(SEC);
  });

  it("stops warning once the session has expired (the sign-out takes over)", () => {
    expect(idleWarningMsLeft(active(t0), t0 + 30 * MIN)).toBeNull();
  });

  it("goes away after activity in this tab or another (shared storage)", () => {
    const now = t0 + 29 * MIN;
    expect(idleWarningMsLeft(active(t0), now)).not.toBeNull();
    expect(idleWarningMsLeft(active(now), now)).toBeNull();
  });

  it("uses the sign-in time when no activity was recorded", () => {
    expect(idleWarningMsLeft({ signedInAt: t0, lastActiveAt: null }, t0 + 29 * MIN)).toBe(MIN);
  });

  it("doesn't warn when the 12-hour limit ends the session first", () => {
    const now = t0 + 12 * HOUR - MIN;
    expect(idleWarningMsLeft(active(now - 29 * MIN), now)).toBeNull();
  });

  it("doesn't warn without a recorded sign-in", () => {
    expect(idleWarningMsLeft({ signedInAt: null, lastActiveAt: t0 }, t0)).toBeNull();
  });
});

describe("formatCountdown", () => {
  it("shows minutes and two-digit seconds, rounding up", () => {
    expect(formatCountdown(2 * MIN)).toBe("2:00");
    expect(formatCountdown(MIN + 500)).toBe("1:01");
    expect(formatCountdown(9_000)).toBe("0:09");
    expect(formatCountdown(1)).toBe("0:01");
  });

  it("never goes below 0:00", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5_000)).toBe("0:00");
  });
});
