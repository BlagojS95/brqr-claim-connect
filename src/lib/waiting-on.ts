// Who has the ball on a claim (fix 30), matching the claim_waiting_on enum in
// Postgres (supabase/migrations/20261109000100_claim_waiting_on.sql).
// Components use these constants and labels, never raw strings.

import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";

export const WAITING_ON_VALUES = ["client", "agency", "carrier"] as const;

export type WaitingOn = (typeof WAITING_ON_VALUES)[number];

export const WAITING_ON = {
  client: "client",
  agency: "agency",
  carrier: "carrier",
} as const satisfies Record<WaitingOn, WaitingOn>;

export const WAITING_ON_LABELS: Record<WaitingOn, string> = {
  client: "Client",
  agency: "Agency",
  carrier: "Carrier",
};

export function isWaitingOn(value: unknown): value is WaitingOn {
  return typeof value === "string" && (WAITING_ON_VALUES as readonly string[]).includes(value);
}

/** The value to show: closed claims aren't waiting on anyone, whatever is stored. */
export function claimWaitingOn(claim: {
  status: ClaimStatus;
  waiting_on: WaitingOn | null;
}): WaitingOn | null {
  if (claim.status === CLAIM_STATUS.closed) return null;
  return claim.waiting_on;
}

/** "Client", "Agency", "Carrier", or "—" for none (closed claims). */
export function waitingOnLabel(value: WaitingOn | null | undefined): string {
  return value ? WAITING_ON_LABELS[value] : "—";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days from a timestamp to `now`, or null when there is none. These are
 * timestamptz values (last_activity_at, created_at, sent_at), not calendar
 * dates, so plain elapsed time is right. A time in the future counts as 0.
 */
export function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((now.getTime() - time) / DAY_MS));
}

/** "Today", "1 day", "12 days", or "—". */
export function daysLabel(days: number | null): string {
  if (days === null) return "—";
  if (days === 0) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}

/** When the claim last changed: its newest activity, else when it was created. */
export function lastUpdateAt(claim: {
  last_activity_at: string | null;
  created_at: string | null;
}): string | null {
  return claim.last_activity_at ?? claim.created_at ?? null;
}
