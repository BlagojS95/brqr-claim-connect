import { describe, expect, it } from "vitest";
import { SESSION_LIMITS, sessionExpiryReason } from "@/lib/session-expiry";

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
    expect(SESSION_LIMITS).toEqual({ idleMs: 30 * MIN, maxMs: 12 * HOUR });
  });
});
