// The one definition of how claims are counted. Pages must not filter on
// claim.status themselves, or their numbers drift apart again.

export type StatusBucket = "Open" | "Pending" | "Closed";

export const STATUS_BUCKETS: StatusBucket[] = ["Open", "Pending", "Closed"];

export interface ClaimStatusFields {
  status: string;
  is_notice_only: boolean;
}

// Status text comes straight from CSV files, so casing can vary. Anything
// active that isn't pending or closed, like "Under Review", counts as open.
export function statusBucket(claim: ClaimStatusFields): StatusBucket {
  const status = claim.status?.trim().toLowerCase();
  if (status === "closed") return "Closed";
  if (claim.is_notice_only || status === "pending") return "Pending";
  return "Open";
}

export function isOpen(claim: ClaimStatusFields): boolean {
  return statusBucket(claim) === "Open";
}

export function countByStatus(claims: ClaimStatusFields[]): Record<StatusBucket, number> {
  const counts: Record<StatusBucket, number> = { Open: 0, Pending: 0, Closed: 0 };
  for (const claim of claims) counts[statusBucket(claim)] += 1;
  return counts;
}
