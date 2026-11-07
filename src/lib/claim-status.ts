// The claim statuses, matching the claim_status enum in Postgres
// (supabase/migrations/20261107000200_claim_status_enum.sql). Components use
// these constants and labels, never raw status strings.

export const CLAIM_STATUSES = ["notice", "submitted", "open", "closed", "reopened"] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS = {
  notice: "notice",
  submitted: "submitted",
  open: "open",
  closed: "closed",
  reopened: "reopened",
} as const satisfies Record<ClaimStatus, ClaimStatus>;

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  notice: "Notice",
  submitted: "Submitted",
  open: "Open",
  closed: "Closed",
  reopened: "Reopened",
};

export function isClaimStatus(value: unknown): value is ClaimStatus {
  return typeof value === "string" && (CLAIM_STATUSES as readonly string[]).includes(value);
}

export function claimStatusLabel(status: string): string {
  return isClaimStatus(status) ? CLAIM_STATUS_LABELS[status] : status;
}

/**
 * Maps free-text status from a CSV onto the enum, so an import never fails on
 * it. Keep in step with the backfill in the claim_status_enum migration.
 * Returns undefined for a blank cell so the stored status is left alone.
 */
export function parseClaimStatus(
  value: string | undefined,
  claimNumber: string | null | undefined,
): ClaimStatus | undefined {
  const text = value
    ?.trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
  if (!text) return undefined;
  if (/^re ?open/.test(text)) return "reopened";
  if (/^clos/.test(text)) return "closed";
  if (/^notice/.test(text)) return "notice";
  if (text === "submitted") return "submitted";
  if (text === "pending") return claimNumber?.trim() ? "open" : "submitted";
  // "Open", "Under Review", "Active" and anything else still in progress.
  return "open";
}
