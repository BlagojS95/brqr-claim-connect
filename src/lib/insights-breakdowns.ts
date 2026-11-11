// Groupings behind the Insights "by cause" and "by location" charts and the
// "largest open claims" table (fix 35). Amounts come from claim-metrics.ts,
// via totalsBy, so they match every other page.

import {
  incurredAmount,
  isOpen,
  paidAmount,
  type ClaimAmounts,
  type ClaimStatusFields,
} from "@/lib/claim-metrics";
import {
  INSIGHTS_MEASURE,
  totalsBy,
  type InsightsMeasure,
  type MeasureTotals,
} from "@/lib/insights-measure";

/** Label for claims with no cause or location recorded. */
export const NOT_GIVEN = "Not given";

export interface BreakdownRow extends MeasureTotals {
  name: string;
}

function collapse(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

/** Totals per cause of loss name; claims without one are "Not given". */
export function totalsByCause<T extends ClaimAmounts & { cause_of_loss: string | null }>(
  claims: readonly T[],
): BreakdownRow[] {
  return Array.from(
    totalsBy(claims, (c) => collapse(c.cause_of_loss) || NOT_GIVEN),
    ([name, totals]) => ({ name, ...totals }),
  );
}

/**
 * Totals per location: the client's site (fix 32) when set, otherwise the
 * loss location text. "Warehouse 3" and " warehouse  3 " are one location,
 * shown with the first spelling seen; blanks are "Not given".
 */
export function totalsByLocation<
  T extends ClaimAmounts & { loss_location: string | null; location_name?: string | null },
>(claims: readonly T[]): BreakdownRow[] {
  const labels = new Map<string, string>();
  const groups = totalsBy(claims, (c) => {
    const text = collapse(c.location_name || c.loss_location);
    if (!text) return NOT_GIVEN;
    const key = text.toLowerCase();
    if (!labels.has(key)) labels.set(key, text);
    return `loc:${key}`;
  });
  return Array.from(groups, ([key, totals]) => ({
    name: key === NOT_GIVEN ? NOT_GIVEN : (labels.get(key.slice(4)) ?? key.slice(4)),
    ...totals,
  }));
}

/**
 * Rows with something to show for the measure, largest first, keeping at most
 * `limit` rows. The rest are added up into one `otherLabel` row so the chart
 * still accounts for every claim.
 */
export function topRows(
  rows: readonly BreakdownRow[],
  measure: InsightsMeasure,
  limit: number,
  otherLabel: string,
): BreakdownRow[] {
  const sorted = rows
    .filter((row) => row[measure] > 0)
    .sort((a, b) => b[measure] - a[measure] || a.name.localeCompare(b.name));
  if (sorted.length <= limit) return sorted;
  const kept = sorted.slice(0, limit - 1);
  const other = sorted.slice(limit - 1).reduce<BreakdownRow>(
    (sum, row) => ({
      name: otherLabel,
      count: sum.count + row.count,
      incurred: sum.incurred + row.incurred,
      paid: sum.paid + row.paid,
    }),
    { name: otherLabel, count: 0, incurred: 0, paid: 0 },
  );
  return [...kept, other];
}

/**
 * Which amount ranks the largest open claims: paid when the page shows paid,
 * otherwise incurred (a count has no size of its own).
 */
export function largestClaimsMeasure(measure: InsightsMeasure): "incurred" | "paid" {
  return measure === INSIGHTS_MEASURE.paid ? INSIGHTS_MEASURE.paid : INSIGHTS_MEASURE.incurred;
}

/** Open claims (claim-metrics isOpen) with the largest amount, biggest first. */
export function largestOpenClaims<
  T extends ClaimAmounts & ClaimStatusFields & { claim_number: string | null },
>(claims: readonly T[], measure: InsightsMeasure, limit = 10): T[] {
  const amount =
    largestClaimsMeasure(measure) === INSIGHTS_MEASURE.paid ? paidAmount : incurredAmount;
  return claims
    .filter((c) => isOpen(c) && amount(c) > 0)
    .sort(
      (a, b) => amount(b) - amount(a) || (a.claim_number ?? "").localeCompare(b.claim_number ?? ""),
    )
    .slice(0, limit);
}
