// The Loss Summary on Reports (fix 44): one table of claims by year and line
// of business, with year / line / carrier filters, sortable columns, a
// subtotal per line within each year, a subtotal per year and a grand total.
// The page, its PDF and Excel files and the shared read-only link are all
// built from buildLossSummary, so they always show the same numbers.

import {
  STATUS_BUCKETS,
  incurredAmount,
  paidAmount,
  reserveAmount,
  statusBucket,
} from "@/lib/claim-metrics";
import { CLAIM_STATUS_LABELS } from "@/lib/claim-status";
import { calendarYear, formatDate } from "@/lib/dates";
import type { AgencyClaim } from "@/lib/overview.types";
import type { ExportCell, ExportTable } from "@/lib/exports/table";

export type LossSummaryClaim = Pick<
  AgencyClaim,
  | "id"
  | "claim_number"
  | "status"
  | "line_of_business"
  | "carrier"
  | "date_of_loss"
  | "paid_amount"
  | "reserve_amount"
>;

export interface LossSummaryFilters {
  year?: number;
  line?: string;
  carrier?: string;
}

export const LOSS_SUMMARY_SORT_KEYS = [
  "year",
  "line",
  "carrier",
  "number",
  "date",
  "status",
  "paid",
  "reserve",
  "incurred",
] as const;

export type LossSummarySortKey = (typeof LOSS_SUMMARY_SORT_KEYS)[number];

export interface LossSummarySort {
  key: LossSummarySortKey;
  dir: "asc" | "desc";
}

/** Newest year first, lines A to Z, newest loss first within a line. */
export const DEFAULT_LOSS_SUMMARY_SORT: LossSummarySort = { key: "year", dir: "desc" };

/** Money and dates start largest / newest first; text A to Z. */
export function defaultLossSummaryDir(key: LossSummarySortKey): "asc" | "desc" {
  return key === "year" ||
    key === "date" ||
    key === "paid" ||
    key === "reserve" ||
    key === "incurred"
    ? "desc"
    : "asc";
}

export function nextLossSummarySort(current: LossSummarySort, key: LossSummarySortKey) {
  return current.key === key
    ? { key, dir: current.dir === "asc" ? ("desc" as const) : ("asc" as const) }
    : { key, dir: defaultLossSummaryDir(key) };
}

export interface LossSummaryTotals {
  claims: number;
  paid: number;
  reserve: number;
  incurred: number;
}

export interface LossSummaryLine<T extends LossSummaryClaim = LossSummaryClaim> {
  line: string;
  rows: T[];
  totals: LossSummaryTotals;
}

export interface LossSummaryYear<T extends LossSummaryClaim = LossSummaryClaim> {
  /** Calendar year of the date of loss; 0 for claims with no date. */
  year: number;
  lines: LossSummaryLine<T>[];
  totals: LossSummaryTotals;
}

export interface LossSummary<T extends LossSummaryClaim = LossSummaryClaim> {
  years: LossSummaryYear<T>[];
  totals: LossSummaryTotals;
}

export const NO_CARRIER = "—";

export function yearLabel(year: number): string {
  return year ? String(year) : "No date";
}

export const carrierLabel = (c: Pick<LossSummaryClaim, "carrier">) =>
  c.carrier?.trim() || NO_CARRIER;

const key = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";

export function sumTotals(claims: readonly LossSummaryClaim[]): LossSummaryTotals {
  return claims.reduce<LossSummaryTotals>(
    (t, c) => ({
      claims: t.claims + 1,
      paid: t.paid + paidAmount(c),
      reserve: t.reserve + reserveAmount(c),
      incurred: t.incurred + incurredAmount(c),
    }),
    { claims: 0, paid: 0, reserve: 0, incurred: 0 },
  );
}

/** The claims matching the year, line and carrier filters (text compared ignoring case). */
export function filterLossSummary<T extends LossSummaryClaim>(
  claims: readonly T[],
  { year, line, carrier }: LossSummaryFilters,
): T[] {
  return claims.filter(
    (c) =>
      (year === undefined || (calendarYear(c.date_of_loss) ?? 0) === year) &&
      (!line || key(c.line_of_business) === key(line)) &&
      (!carrier || key(carrierLabel(c)) === key(carrier)),
  );
}

export interface LossSummaryOptions {
  /** Newest first; 0 stands for "No date". */
  years: number[];
  lines: string[];
  carriers: string[];
}

function distinct(values: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const v of values) if (!byKey.has(key(v))) byKey.set(key(v), v.trim());
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "en-US", { sensitivity: "base" }));
}

/** The choices for each filter, from the claims the user can see. */
export function lossSummaryOptions(claims: readonly LossSummaryClaim[]): LossSummaryOptions {
  const years = [...new Set(claims.map((c) => calendarYear(c.date_of_loss) ?? 0))].sort((a, b) =>
    a === 0 ? 1 : b === 0 ? -1 : b - a,
  );
  return {
    years,
    lines: distinct(claims.map((c) => c.line_of_business)),
    carriers: distinct(claims.map(carrierLabel)),
  };
}

function rowValue(c: LossSummaryClaim, sortKey: LossSummarySortKey): string | number | null {
  switch (sortKey) {
    case "carrier":
      return key(carrierLabel(c));
    case "number":
      return key(c.claim_number) || null;
    case "status":
      return STATUS_BUCKETS.indexOf(statusBucket(c));
    case "paid":
      return paidAmount(c);
    case "reserve":
      return reserveAmount(c);
    case "incurred":
      return incurredAmount(c);
    default:
      // year, line and date: rows inside a line group go by date of loss.
      return c.date_of_loss?.slice(0, 10) ?? null;
  }
}

function compareRows(a: LossSummaryClaim, b: LossSummaryClaim, sort: LossSummarySort): number {
  const byYearOrLine = sort.key === "year" || sort.key === "line";
  const dir = byYearOrLine ? "desc" : sort.dir;
  const av = rowValue(a, sort.key);
  const bv = rowValue(b, sort.key);
  let cmp = 0;
  // Missing values go last whichever way the column is sorted.
  if (av === null && bv !== null) return 1;
  if (bv === null && av !== null) return -1;
  if (av !== null && bv !== null) {
    cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "en-US", { numeric: true });
  }
  if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
  return (a.claim_number ?? "").localeCompare(b.claim_number ?? "") || a.id.localeCompare(b.id);
}

/**
 * Years, then lines within each year, each with its subtotal, and a grand
 * total. Sorting on Year or Line orders those groups; any other column sorts
 * the claims within each line, so the subtotals always stay meaningful.
 */
export function buildLossSummary<T extends LossSummaryClaim>(
  claims: readonly T[],
  sort: LossSummarySort = DEFAULT_LOSS_SUMMARY_SORT,
): LossSummary<T> {
  const byYear = new Map<number, Map<string, T[]>>();
  for (const c of claims) {
    const year = calendarYear(c.date_of_loss) ?? 0;
    const lines = byYear.get(year) ?? new Map<string, T[]>();
    const rows = lines.get(c.line_of_business) ?? [];
    rows.push(c);
    lines.set(c.line_of_business, rows);
    byYear.set(year, lines);
  }

  const yearDir = sort.key === "year" ? sort.dir : "desc";
  const lineDir = sort.key === "line" ? sort.dir : "asc";
  const years = [...byYear.entries()]
    .sort(([a], [b]) => {
      // "No date" stays last.
      if (a === 0 || b === 0) return a === 0 ? 1 : -1;
      return yearDir === "asc" ? a - b : b - a;
    })
    .map(([year, lineMap]): LossSummaryYear<T> => {
      const lines = [...lineMap.entries()]
        .sort(([a], [b]) => {
          const cmp = a.localeCompare(b, "en-US", { sensitivity: "base" });
          return lineDir === "asc" ? cmp : -cmp;
        })
        .map(([line, rows]) => {
          const sorted = [...rows].sort((a, b) => compareRows(a, b, sort));
          return { line, rows: sorted, totals: sumTotals(sorted) };
        });
      return { year, lines, totals: sumTotals(lines.flatMap((l) => l.rows)) };
    });

  return { years, totals: sumTotals(claims) };
}

// ── Exports ────────────────────────────────────────────────────────────────

const claimNumber = (c: LossSummaryClaim) => c.claim_number?.trim() || "Number pending";

/** The page's table, row for row, for the PDF and Excel files. */
export function lossSummaryExportTable(summary: LossSummary): ExportTable & { emphasis: number[] } {
  const rows: ExportCell[][] = [];
  const emphasis: number[] = [];
  const subtotal = (label: string, t: LossSummaryTotals) => {
    emphasis.push(rows.length);
    rows.push([
      label,
      null,
      null,
      `${t.claims} claim${t.claims === 1 ? "" : "s"}`,
      null,
      null,
      t.paid,
      t.reserve,
      t.incurred,
    ]);
  };
  for (const y of summary.years) {
    for (const l of y.lines) {
      for (const c of l.rows) {
        rows.push([
          yearLabel(y.year),
          l.line,
          carrierLabel(c),
          claimNumber(c),
          formatDate(c.date_of_loss, "") || null,
          CLAIM_STATUS_LABELS[statusBucket(c)],
          paidAmount(c),
          reserveAmount(c),
          incurredAmount(c),
        ]);
      }
      subtotal(`${yearLabel(y.year)} · ${l.line} subtotal`, l.totals);
    }
    subtotal(`${yearLabel(y.year)} subtotal`, y.totals);
  }
  const t = summary.totals;
  return {
    columns: [
      { label: "Year", kind: "text" },
      { label: "Line of business", kind: "text" },
      { label: "Carrier", kind: "text" },
      { label: "Claim #", kind: "text" },
      { label: "Date of loss", kind: "date" },
      { label: "Status", kind: "text" },
      { label: "Paid", kind: "money" },
      { label: "Reserve", kind: "money" },
      { label: "Incurred", kind: "money" },
    ],
    rows,
    totals: [
      "Grand total",
      null,
      null,
      `${t.claims} claim${t.claims === 1 ? "" : "s"}`,
      null,
      null,
      t.paid,
      t.reserve,
      t.incurred,
    ],
    emphasis,
  };
}

/** "Year 2026 · General Liability · Chubb", the filters a report was made with. */
export function lossSummaryFilterLabel(filters: LossSummaryFilters): string {
  const parts = [
    filters.year !== undefined ? `Year ${yearLabel(filters.year)}` : null,
    filters.line || null,
    filters.carrier || null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "All years, lines and carriers";
}
