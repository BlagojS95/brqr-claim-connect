// The one definition of how claims are counted. Pages must not filter on
// claim.status themselves, or their numbers drift apart again.

import { CLAIM_STATUS, CLAIM_STATUSES, type ClaimStatus } from "@/lib/claim-status";
import { calendarYear } from "@/lib/dates";

export type StatusBucket = ClaimStatus;

/** Every status, in display order. Filters, tables and charts iterate this. */
export const STATUS_BUCKETS: readonly StatusBucket[] = CLAIM_STATUSES;

export interface ClaimStatusFields {
  status: ClaimStatus;
}

// claims.status is an enum, so the stored value is the bucket. The CSV
// importer maps free text onto it (parseClaimStatus in claim-status.ts).
export function statusBucket(claim: ClaimStatusFields): StatusBucket {
  return claim.status;
}

/** Open means the carrier has it and it is still being worked: open or reopened. */
export function isOpen(claim: ClaimStatusFields): boolean {
  const status = statusBucket(claim);
  return status === CLAIM_STATUS.open || status === CLAIM_STATUS.reopened;
}

export function countByStatus(claims: ClaimStatusFields[]): Record<StatusBucket, number> {
  const counts = Object.fromEntries(STATUS_BUCKETS.map((s) => [s, 0])) as Record<
    StatusBucket,
    number
  >;
  for (const claim of claims) counts[statusBucket(claim)] += 1;
  return counts;
}

/** The "Open Claims" figure every page shows. */
export function openCount(claims: ClaimStatusFields[]): number {
  return claims.filter(isOpen).length;
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

/** Money back on the claim (subrogation, salvage). NULL means none. */
export function recoveryAmount(claim: { recovery_amount: number | null }): number {
  return Number(claim.recovery_amount ?? 0);
}

/** Incurred less recoveries, never below zero. */
export function netIncurred(claim: ClaimAmounts & { recovery_amount: number | null }): number {
  return Math.max(0, incurredAmount(claim) - recoveryAmount(claim));
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
  const closed = claims.filter((claim) => statusBucket(claim) === CLAIM_STATUS.closed);
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
  avgClosedYtd: number | null;
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
    avgClosedYtd: currentAvg,
    previousYear: year - 1,
    countChange: percentChange(current.length, previous.length),
    avgClosedChange:
      currentAvg === null || previousAvg === null ? null : percentChange(currentAvg, previousAvg),
  };
}
