// Signs people out of the portal after a while, so an open browser doesn't stay
// logged in forever. Supabase keeps refreshing its token indefinitely, so the
// limits are enforced here: sign-in time and last activity are kept in
// localStorage (shared by all tabs) and checked before any /_app page loads
// and once a minute while one is open.

export const SESSION_LIMITS = {
  idleMs: 30 * 60 * 1000, // no clicks or typing for 30 minutes
  maxMs: 12 * 60 * 60 * 1000, // 12 hours after signing in, however active
};

const SIGNED_IN_AT = "claimsqr.signedInAt";
const LAST_ACTIVE_AT = "claimsqr.lastActiveAt";

export interface SessionTimes {
  signedInAt: number | null;
  lastActiveAt: number | null;
}

export type ExpiryReason = "idle" | "max" | "unknown";

// Why the session should end now, or null if it may continue. A session with no
// recorded sign-in time (signed in before this check existed, or storage
// cleared) is treated as expired, so it can't live on indefinitely.
export function sessionExpiryReason(
  times: SessionTimes,
  now: number,
  limits = SESSION_LIMITS,
): ExpiryReason | null {
  if (times.signedInAt === null) return "unknown";
  if (now - times.signedInAt >= limits.maxMs) return "max";
  const lastActive = times.lastActiveAt ?? times.signedInAt;
  if (now - lastActive >= limits.idleMs) return "idle";
  return null;
}

function readNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function write(key: string, value: number | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    // Storage blocked: the session then counts as expired on the next check.
  }
}

export function readSessionTimes(): SessionTimes {
  return { signedInAt: readNumber(SIGNED_IN_AT), lastActiveAt: readNumber(LAST_ACTIVE_AT) };
}

// Call right after a successful password sign-in.
export function markSignedIn(now = Date.now()) {
  write(SIGNED_IN_AT, now);
  write(LAST_ACTIVE_AT, now);
}

export function markActive(now = Date.now()) {
  write(LAST_ACTIVE_AT, now);
}

export function clearSessionTimes() {
  write(SIGNED_IN_AT, null);
  write(LAST_ACTIVE_AT, null);
}

export const EXPIRY_MESSAGE: Record<ExpiryReason, string> = {
  idle: "You were signed out after 30 minutes of inactivity.",
  max: "Your session ended. Please sign in again.",
  unknown: "Please sign in again.",
};
