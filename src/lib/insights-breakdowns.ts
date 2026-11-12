// Groupings behind the Insights "by cause" and "by location" charts and the
// "largest open claims" table (fix 35). Amounts come from claim-metrics.ts,
// via totalsBy, so they match every other page.

import {
  STATUS_BUCKETS,
  incurredAmount,
  isOpen,
  paidAmount,
  statusBucket,
  type ClaimAmounts,
  type ClaimStatusFields,
} from "@/lib/claim-metrics";
import { CLAIM_STATUS_LABELS } from "@/lib/claim-status";
import type { ClaimsSearch } from "@/lib/claims-list";
import { policyNumberKey } from "@/lib/policy-claims";
import {
  bucketLabel,
  inRange,
  priorRange,
  type DateRange,
  type TimeBucket,
} from "@/lib/insights-period";
import {
  INSIGHTS_MEASURE,
  totalsBy,
  type InsightsMeasure,
  type MeasureTotals,
} from "@/lib/insights-measure";

/** Label for claims with no cause or location recorded. */
export const NOT_GIVEN = "Not given";

/** The claims-list filter a chart click opens (fix 45). */
export type ClaimLinkFilter = Partial<
  Pick<ClaimsSearch, "line" | "cause" | "policy" | "location" | "carrier" | "status">
>;

export interface BreakdownRow extends MeasureTotals {
  name: string;
  /** Missing for "Not given" and "All other" rows, which the list can't filter on. */
  filter?: ClaimLinkFilter;
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
    ([name, totals]) => ({
      name,
      ...totals,
      ...(name === NOT_GIVEN ? {} : { filter: { cause: name } }),
    }),
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
  return Array.from(groups, ([key, totals]) => {
    if (key === NOT_GIVEN) return { name: NOT_GIVEN, ...totals };
    const name = labels.get(key.slice(4)) ?? key.slice(4);
    return { name, ...totals, filter: { location: name } };
  });
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

// ── Breakdown selector and prior-year compare (fix 45) ─────────────────────

export const BREAKDOWN_DIMENSIONS = [
  "line",
  "cause",
  "policy",
  "location",
  "carrier",
  "status",
] as const;

export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

export const BREAKDOWN_LABELS: Record<BreakdownDimension, string> = {
  line: "Line of business",
  cause: "Cause",
  policy: "Policy",
  location: "Location",
  carrier: "Carrier",
  status: "Status",
};

export function parseBreakdown(value: unknown, fallback: BreakdownDimension): BreakdownDimension {
  return typeof value === "string" && (BREAKDOWN_DIMENSIONS as readonly string[]).includes(value)
    ? (value as BreakdownDimension)
    : fallback;
}

export type BreakdownClaim = ClaimAmounts &
  ClaimStatusFields & {
    line_of_business: string;
    carrier: string | null;
    cause_of_loss: string | null;
    policy_number: string | null;
    loss_location: string | null;
    location_name?: string | null;
  };

/** Totals per value of the dimension, each row with the filter a click opens. */
export function breakdownBy(
  claims: readonly BreakdownClaim[],
  dimension: BreakdownDimension,
): BreakdownRow[] {
  switch (dimension) {
    case "cause":
      return totalsByCause(claims);
    case "location":
      return totalsByLocation(claims);
    case "line":
      return Array.from(
        totalsBy(claims, (c) => c.line_of_business),
        ([name, totals]) => ({
          name,
          ...totals,
          filter: { line: name },
        }),
      );
    case "carrier":
      return Array.from(
        totalsBy(claims, (c) => collapse(c.carrier) || NOT_GIVEN),
        ([name, totals]) => ({
          name,
          ...totals,
          ...(name === NOT_GIVEN ? {} : { filter: { carrier: name } }),
        }),
      );
    case "status": {
      const groups = totalsBy(claims, statusBucket);
      return STATUS_BUCKETS.flatMap((status) => {
        const totals = groups.get(status);
        return totals ? [{ name: CLAIM_STATUS_LABELS[status], ...totals, filter: { status } }] : [];
      });
    }
    case "policy": {
      // "GL 1001" and "gl1001" are one policy, shown with the first spelling.
      const labels = new Map<string, string>();
      const groups = totalsBy(claims, (c) => {
        const key = policyNumberKey(c.policy_number);
        if (!key) return NOT_GIVEN;
        if (!labels.has(key)) labels.set(key, collapse(c.policy_number));
        return `pol:${key}`;
      });
      return Array.from(groups, ([key, totals]) => {
        if (key === NOT_GIVEN) return { name: NOT_GIVEN, ...totals };
        const name = labels.get(key.slice(4)) ?? key.slice(4);
        return { name, ...totals, filter: { policy: name } };
      });
    }
  }
}

const ZERO: MeasureTotals = { count: 0, incurred: 0, paid: 0 };

export interface CompareRow extends BreakdownRow {
  /** The same group's totals in the prior-year period (zero when there are none). */
  prior: MeasureTotals;
}

/** Joins this period's rows with the prior period's by name. */
export function withPrior(current: BreakdownRow[], prior: BreakdownRow[] = []): CompareRow[] {
  const priorByName = new Map(prior.map((r) => [r.name, r]));
  const rows: CompareRow[] = current.map((r) => {
    const p = priorByName.get(r.name);
    return { ...r, prior: p ? { count: p.count, incurred: p.incurred, paid: p.paid } : ZERO };
  });
  const seen = new Set(current.map((r) => r.name));
  for (const p of prior) {
    if (seen.has(p.name)) continue;
    rows.push({
      name: p.name,
      filter: p.filter,
      ...ZERO,
      prior: { count: p.count, incurred: p.incurred, paid: p.paid },
    });
  }
  return rows;
}

const add = (a: MeasureTotals, b: MeasureTotals): MeasureTotals => ({
  count: a.count + b.count,
  incurred: a.incurred + b.incurred,
  paid: a.paid + b.paid,
});

/**
 * Like topRows, for compare rows: groups with something in either period,
 * largest this period first, at most `limit`, the rest summed into one
 * `otherLabel` row so the chart still accounts for every claim. Status keeps
 * its own order.
 */
export function topCompareRows(
  rows: readonly CompareRow[],
  measure: InsightsMeasure,
  limit: number,
  otherLabel: string,
  keepOrder = false,
): CompareRow[] {
  const shown = rows.filter((r) => r[measure] > 0 || r.prior[measure] > 0);
  const sorted = keepOrder
    ? shown
    : [...shown].sort(
        (a, b) =>
          b[measure] - a[measure] ||
          b.prior[measure] - a.prior[measure] ||
          a.name.localeCompare(b.name),
      );
  if (sorted.length <= limit) return sorted;
  const kept = sorted.slice(0, limit - 1);
  const rest = sorted.slice(limit - 1);
  const current = rest.reduce<MeasureTotals>((s, r) => add(s, r), ZERO);
  const prior = rest.reduce<MeasureTotals>((s, r) => add(s, r.prior), ZERO);
  return [...kept, { name: otherLabel, ...current, prior }];
}

export interface TrendPoint extends MeasureTotals {
  key: string;
  label: string;
  /** The claims-list date range a click on this point opens. */
  range: DateRange;
  prior: MeasureTotals;
}

/**
 * Totals per time bucket (month or year, see timeBuckets), with the same
 * bucket a year earlier when comparing. Every claim with a date of loss in
 * the period lands in exactly one bucket.
 */
export function trendSeries<T extends ClaimAmounts & { date_of_loss: string | null }>(
  claims: readonly T[],
  buckets: readonly TimeBucket[],
  priorClaims: readonly T[] | null = null,
): TrendPoint[] {
  const sum = (list: readonly T[], range: DateRange): MeasureTotals =>
    list.reduce<MeasureTotals>(
      (t, c) =>
        inRange(c.date_of_loss, range)
          ? {
              count: t.count + 1,
              incurred: t.incurred + incurredAmount(c),
              paid: t.paid + paidAmount(c),
            }
          : t,
      ZERO,
    );
  return buckets.map((b) => ({
    key: b.key,
    label: bucketLabel(b.key),
    range: b.range,
    ...sum(claims, b.range),
    prior: priorClaims ? sum(priorClaims, priorRange(b.range)) : ZERO,
  }));
}
