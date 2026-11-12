// The period every Insights chart shares (fix 45), kept in the URL
// (?period=ytd, or ?period=custom&from=2026-01-01&to=2026-06-30), and the
// same-length period a year earlier for "Compare to prior year". The executive
// report (fix 46) uses the same ranges so its numbers match Insights.
//
// Ranges are calendar dates, both ends inclusive, as "YYYY-MM-DD" text, which
// compares in date order. A claim is in a range by its date of loss; claims
// with no date of loss only count in "All time".

import { todayIso } from "@/lib/dates";

export const INSIGHTS_PERIODS = ["all", "ytd", "last12", "policy", "custom"] as const;
export type InsightsPeriod = (typeof INSIGHTS_PERIODS)[number];

export const INSIGHTS_PERIOD = {
  all: "all",
  ytd: "ytd",
  last12: "last12",
  policy: "policy",
  custom: "custom",
} as const satisfies Record<InsightsPeriod, InsightsPeriod>;

export const INSIGHTS_PERIOD_LABELS: Record<InsightsPeriod, string> = {
  all: "All time",
  ytd: "Year to date",
  last12: "Last 12 months",
  policy: "Policy year",
  custom: "Custom",
};

export const DEFAULT_INSIGHTS_PERIOD: InsightsPeriod = INSIGHTS_PERIOD.all;

export interface DateRange {
  from: string;
  to: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date as "YYYY-MM-DD", or null. */
export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = ISO_DATE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
    ? value.trim()
    : null;
}

export function parseInsightsPeriod(value: unknown): InsightsPeriod {
  return typeof value === "string" && (INSIGHTS_PERIODS as readonly string[]).includes(value)
    ? (value as InsightsPeriod)
    : DEFAULT_INSIGHTS_PERIOD;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso: string, days: number): string {
  const date = utc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

/** Same day n years away; Feb 29 becomes Feb 28 in a non-leap year. */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y + years, m - 1, 1));
  const lastDay = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return toIso(target);
}

export interface PolicyTermFields {
  effective_date: string | null;
  expiry_date: string | null;
}

/**
 * The policy year in force on `today`: the newest term (both dates known)
 * that contains it. Null when no policy is in force.
 */
export function currentPolicyTerm(
  policies: readonly PolicyTermFields[],
  today: string,
): DateRange | null {
  const terms = policies
    .map((p) => ({ from: p.effective_date?.slice(0, 10), to: p.expiry_date?.slice(0, 10) }))
    .filter((t): t is DateRange => !!t.from && !!t.to && t.from <= today && today <= t.to)
    .sort((a, b) => b.from.localeCompare(a.from) || b.to.localeCompare(a.to));
  return terms[0] ?? null;
}

export interface PeriodInput {
  period: InsightsPeriod;
  from?: string;
  to?: string;
  today?: string;
  policies?: readonly PolicyTermFields[];
}

/** The date range a period covers; null means all time (no limit). */
export function resolvePeriod({
  period,
  from,
  to,
  today = todayIso(),
  policies = [],
}: PeriodInput): DateRange | null {
  switch (period) {
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "last12":
      return { from: addDays(addYears(today, -1), 1), to: today };
    case "policy":
      return currentPolicyTerm(policies, today);
    case "custom": {
      const start = parseIsoDate(from);
      const end = parseIsoDate(to);
      return start && end && start <= end ? { from: start, to: end } : null;
    }
    default:
      return null;
  }
}

/** The same stretch one year earlier. */
export function priorRange(range: DateRange): DateRange {
  return { from: addYears(range.from, -1), to: addYears(range.to, -1) };
}

export function inRange(dateOfLoss: string | null | undefined, range: DateRange | null): boolean {
  if (!range) return true;
  const day = dateOfLoss?.slice(0, 10);
  return !!day && range.from <= day && day <= range.to;
}

/** The claims whose date of loss falls in the range (all of them when there is none). */
export function claimsInRange<T extends { date_of_loss: string | null }>(
  claims: readonly T[],
  range: DateRange | null,
): T[] {
  return range ? claims.filter((c) => inRange(c.date_of_loss, range)) : [...claims];
}

/** "01/01/2026 – 11/12/2026" in the app's date format. */
export function rangeLabel(range: DateRange | null, format: (iso: string) => string): string {
  return range ? `${format(range.from)} – ${format(range.to)}` : "All time";
}

/** Percent change from `previous`; null when there is nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  return previous === 0 ? null : ((current - previous) / previous) * 100;
}

export interface TimeBucket {
  /** "2026" or "2026-03". */
  key: string;
  range: DateRange;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mar 2026" for a month bucket, "2026" for a year. */
export function bucketLabel(key: string): string {
  if (key.length === 4) return key;
  return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

const MAX_MONTH_BUCKETS = 24;

/**
 * The trend chart's buckets: months across the range when it spans up to two
 * years, otherwise calendar years. All time uses the years the claims have.
 */
export function timeBuckets(
  range: DateRange | null,
  claims: readonly { date_of_loss: string | null }[],
): TimeBucket[] {
  if (!range) {
    const years = [
      ...new Set(claims.map((c) => c.date_of_loss?.slice(0, 4)).filter((y): y is string => !!y)),
    ].sort();
    return years.map((y) => ({ key: y, range: { from: `${y}-01-01`, to: `${y}-12-31` } }));
  }
  const months =
    (Number(range.to.slice(0, 4)) - Number(range.from.slice(0, 4))) * 12 +
    Number(range.to.slice(5, 7)) -
    Number(range.from.slice(5, 7)) +
    1;
  const clip = (r: DateRange): DateRange => ({
    from: r.from < range.from ? range.from : r.from,
    to: r.to > range.to ? range.to : r.to,
  });
  const buckets: TimeBucket[] = [];
  if (months <= MAX_MONTH_BUCKETS) {
    let cursor = `${range.from.slice(0, 7)}-01`;
    while (cursor <= range.to) {
      const next = nextMonth(cursor);
      buckets.push({
        key: cursor.slice(0, 7),
        range: clip({ from: cursor, to: addDays(next, -1) }),
      });
      cursor = next;
    }
    return buckets;
  }
  for (let y = Number(range.from.slice(0, 4)); y <= Number(range.to.slice(0, 4)); y++) {
    buckets.push({ key: String(y), range: clip({ from: `${y}-01-01`, to: `${y}-12-31` }) });
  }
  return buckets;
}

function nextMonth(firstOfMonth: string): string {
  const y = Number(firstOfMonth.slice(0, 4));
  const m = Number(firstOfMonth.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
