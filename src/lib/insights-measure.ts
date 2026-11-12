// What the Insights charts measure: claim count, incurred or paid. Read from
// the URL (?measure=count|incurred|paid), so Home can link straight to
// /insights?measure=paid. Amounts come from claim-metrics.ts.

import { incurredAmount, paidAmount, type ClaimAmounts } from "@/lib/claim-metrics";

export const INSIGHTS_MEASURES = ["count", "incurred", "paid"] as const;

export type InsightsMeasure = (typeof INSIGHTS_MEASURES)[number];

export const INSIGHTS_MEASURE = {
  count: "count",
  incurred: "incurred",
  paid: "paid",
} as const satisfies Record<InsightsMeasure, InsightsMeasure>;

export const INSIGHTS_MEASURE_LABELS: Record<InsightsMeasure, string> = {
  count: "Count",
  incurred: "Incurred",
  paid: "Paid",
};

export const DEFAULT_INSIGHTS_MEASURE: InsightsMeasure = INSIGHTS_MEASURE.count;

export function parseInsightsMeasure(value: unknown): InsightsMeasure {
  return typeof value === "string" && (INSIGHTS_MEASURES as readonly string[]).includes(value)
    ? (value as InsightsMeasure)
    : DEFAULT_INSIGHTS_MEASURE;
}

export function isMoneyMeasure(measure: InsightsMeasure): boolean {
  return measure !== INSIGHTS_MEASURE.count;
}

/** "Claims" for a count, otherwise the amount's name ("Paid", "Incurred"). */
export function measureNoun(measure: InsightsMeasure): string {
  return measure === INSIGHTS_MEASURE.count ? "Claims" : INSIGHTS_MEASURE_LABELS[measure];
}

export interface MeasureTotals {
  count: number;
  incurred: number;
  paid: number;
}

/**
 * Totals every measure per group. Claims whose key is null are left out
 * (for example a claim with no date of loss in a by-year chart).
 */
export function totalsBy<T extends ClaimAmounts, K>(
  claims: readonly T[],
  keyOf: (claim: T) => K | null,
): Map<K, MeasureTotals> {
  const groups = new Map<K, MeasureTotals>();
  for (const claim of claims) {
    const key = keyOf(claim);
    if (key === null) continue;
    const totals = groups.get(key) ?? { count: 0, incurred: 0, paid: 0 };
    totals.count += 1;
    totals.incurred += incurredAmount(claim);
    totals.paid += paidAmount(claim);
    groups.set(key, totals);
  }
  return groups;
}
