// The one definition of how claims are counted. Pages must not filter on
// claim.status themselves, or their numbers drift apart again.

import { calendarYear } from "@/lib/dates";

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

export interface ClaimAmounts {
  paid_amount: number | null;
  reserve_amount: number | null;
}

export function paidAmount(claim: Pick<ClaimAmounts, "paid_amount">): number {
  return Number(claim.paid_amount ?? 0);
}

export function reserveAmount(claim: Pick<ClaimAmounts, "reserve_amount">): number {
  return Number(claim.reserve_amount ?? 0);
}

// Imported rows with no reserve hold NULL, which counts as nothing reserved.
export function incurredAmount(claim: ClaimAmounts): number {
  return paidAmount(claim) + reserveAmount(claim);
}

export function totalPaid(claims: ClaimAmounts[]): number {
  return claims.reduce((sum, claim) => sum + paidAmount(claim), 0);
}

export function totalIncurred(claims: ClaimAmounts[]): number {
  return claims.reduce((sum, claim) => sum + incurredAmount(claim), 0);
}

export interface YearSummary {
  claims: number;
  paid: number;
  incurred: number;
}

export function summarize(claims: ClaimAmounts[]): YearSummary {
  return { claims: claims.length, paid: totalPaid(claims), incurred: totalIncurred(claims) };
}

// Open claims are still developing, so only closed claims give a real average.
export function avgClosedCost(claims: (ClaimStatusFields & ClaimAmounts)[]): number | null {
  const closed = claims.filter((claim) => statusBucket(claim) === "Closed");
  return closed.length ? totalIncurred(closed) / closed.length : null;
}

function percentChange(current: number, previous: number): number | null {
  return previous === 0 ? null : ((current - previous) / previous) * 100;
}

/** Keeps claims with a date of loss from Jan 1 of `year` up to today's month and day. */
function yearToDate<T extends { date_of_loss: string | null }>(
  claims: T[],
  year: number,
  today: string,
): T[] {
  const monthDay = today.slice(5, 10);
  return claims.filter((claim) => {
    const date = claim.date_of_loss;
    return date != null && calendarYear(date) === year && date.slice(5, 10) <= monthDay;
  });
}

export interface YtdComparison {
  currentYtd: number;
  previousYear: number;
  countChange: number | null;
  avgClosedChange: number | null;
}

/** This year to date against the same stretch of last year. `today` is "YYYY-MM-DD". */
export function compareYtd<
  T extends ClaimStatusFields & ClaimAmounts & { date_of_loss: string | null },
>(claims: T[], today: string): YtdComparison {
  const year = Number(today.slice(0, 4));
  const current = yearToDate(claims, year, today);
  const previous = yearToDate(claims, year - 1, today);
  const currentAvg = avgClosedCost(current);
  const previousAvg = avgClosedCost(previous);
  return {
    currentYtd: current.length,
    previousYear: year - 1,
    countChange: percentChange(current.length, previous.length),
    avgClosedChange:
      currentAvg === null || previousAvg === null ? null : percentChange(currentAvg, previousAvg),
  };
}
