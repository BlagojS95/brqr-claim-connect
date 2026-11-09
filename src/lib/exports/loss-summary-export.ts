// The Loss Summary on Reports, grouped by year, line of business and carrier,
// and its exports (fix 34). The page and the PDF / Excel files are built from
// the same groups, so their totals are the same numbers.

import {
  STATUS_BUCKETS,
  countByStatus,
  incurredAmount,
  paidAmount,
  reserveAmount,
  totalIncurred,
  totalPaid,
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
  | "claimant_name"
  | "paid_amount"
  | "reserve_amount"
>;

export interface LossSummaryGroup<T extends LossSummaryClaim = LossSummaryClaim> {
  /** Calendar year of the date of loss; 0 for claims with no date. */
  year: number;
  lob: string;
  carrier: string;
  rows: T[];
}

/** Groups newest year first, then line and carrier A to Z, filtered by the search box text. */
export function groupLossSummary<T extends LossSummaryClaim>(
  claims: T[],
  search = "",
): LossSummaryGroup<T>[] {
  const map = new Map<string, LossSummaryGroup<T>>();
  for (const c of claims) {
    const year = calendarYear(c.date_of_loss) ?? 0;
    const lob = c.line_of_business;
    const carrier = c.carrier || "—";
    const key = `${year}|${lob}|${carrier}`;
    let group = map.get(key);
    if (!group) {
      group = { year, lob, carrier, rows: [] };
      map.set(key, group);
    }
    group.rows.push(c);
  }
  const groups = Array.from(map.values()).sort(
    (a, b) => b.year - a.year || a.lob.localeCompare(b.lob) || a.carrier.localeCompare(b.carrier),
  );
  const term = search.trim().toLowerCase();
  if (!term) return groups;
  return groups.filter(
    (g) =>
      yearLabel(g.year).toLowerCase().includes(term) ||
      g.lob.toLowerCase().includes(term) ||
      g.carrier.toLowerCase().includes(term),
  );
}

export function yearLabel(year: number): string {
  return year ? String(year) : "No date";
}

/** "2 Open · 1 Closed", as the totals row on the page shows it. */
export function statusCountsLabel(claims: LossSummaryClaim[]): string {
  const counts = countByStatus(claims);
  return STATUS_BUCKETS.filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${CLAIM_STATUS_LABELS[s]}`)
    .join(" · ");
}

const claimNumber = (c: LossSummaryClaim) => c.claim_number?.trim() || "Number pending";

/** One row per group: the totals rows of the page, plus a grand total. */
export function lossSummaryTable(groups: LossSummaryGroup[]): ExportTable {
  const all = groups.flatMap((g) => g.rows);
  return {
    columns: [
      { label: "Year", kind: "text" },
      { label: "Line of business", kind: "text" },
      { label: "Carrier", kind: "text" },
      { label: "Claims", kind: "text" },
      { label: "Status", kind: "text" },
      { label: "Paid", kind: "money" },
      { label: "Incurred", kind: "money" },
    ],
    rows: groups.map((g) => [
      yearLabel(g.year),
      g.lob,
      g.carrier,
      String(g.rows.length),
      statusCountsLabel(g.rows),
      totalPaid(g.rows),
      totalIncurred(g.rows),
    ]),
    totals: [
      "Total",
      null,
      null,
      String(all.length),
      statusCountsLabel(all),
      totalPaid(all),
      totalIncurred(all),
    ],
  };
}

const DETAIL_COLUMNS = [
  { label: "Claim #", kind: "text" },
  { label: "Date of loss", kind: "date" },
  { label: "Claimant", kind: "text" },
  { label: "Status", kind: "text" },
  { label: "Paid", kind: "money" },
  { label: "Reserve", kind: "money" },
  { label: "Incurred", kind: "money" },
] as const satisfies ExportTable["columns"];

function detailCells(c: LossSummaryClaim): ExportCell[] {
  return [
    claimNumber(c),
    formatDate(c.date_of_loss, "") || null,
    c.claimant_name?.trim() || null,
    CLAIM_STATUS_LABELS[c.status],
    paidAmount(c),
    reserveAmount(c),
    incurredAmount(c),
  ];
}

function detailTotals(label: string, claims: LossSummaryClaim[]): ExportCell[] {
  return [
    label,
    null,
    null,
    statusCountsLabel(claims),
    totalPaid(claims),
    claims.reduce((sum, c) => sum + reserveAmount(c), 0),
    totalIncurred(claims),
  ];
}

/** The claims of one group with its totals row: one table in the PDF. */
export function lossRunGroupTable(group: LossSummaryGroup): ExportTable {
  return {
    columns: [...DETAIL_COLUMNS],
    rows: group.rows.map(detailCells),
    totals: detailTotals(`Total (${group.rows.length})`, group.rows),
  };
}

/** Every claim of every group in one flat sheet, with the group as columns. */
export function lossRunDetailTable(groups: LossSummaryGroup[]): ExportTable {
  const all = groups.flatMap((g) => g.rows);
  return {
    columns: [
      { label: "Year", kind: "text" },
      { label: "Line of business", kind: "text" },
      { label: "Carrier", kind: "text" },
      ...DETAIL_COLUMNS,
    ],
    rows: groups.flatMap((g) =>
      g.rows.map((c) => [yearLabel(g.year), g.lob, g.carrier, ...detailCells(c)]),
    ),
    totals: ["Total", null, null, ...detailTotals(`${all.length} claims`, all)],
  };
}
