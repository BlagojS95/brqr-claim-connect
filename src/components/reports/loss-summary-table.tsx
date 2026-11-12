import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { incurredAmount, paidAmount, reserveAmount, statusBucket } from "@/lib/claim-metrics";
import { formatDate } from "@/lib/dates";
import {
  carrierLabel,
  yearLabel,
  type LossSummary,
  type LossSummaryClaim,
  type LossSummarySort,
  type LossSummarySortKey,
  type LossSummaryTotals,
} from "@/lib/loss-summary";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const COLUMNS: { key: LossSummarySortKey; label: string; money?: boolean }[] = [
  { key: "year", label: "Year" },
  { key: "line", label: "Line" },
  { key: "carrier", label: "Carrier" },
  { key: "number", label: "Claim #" },
  { key: "date", label: "Date of loss" },
  { key: "status", label: "Status" },
  { key: "paid", label: "Paid", money: true },
  { key: "reserve", label: "Reserve", money: true },
  { key: "incurred", label: "Incurred", money: true },
];

const claimsLabel = (n: number) => `${n} claim${n === 1 ? "" : "s"}`;

/**
 * The Loss Summary table (fix 44): claims by year and line with a subtotal
 * per line, per year and a grand total. Used on Reports and on a shared
 * read-only link; `linkClaims` is off on the shared page, which has no session.
 */
export function LossSummaryTable({
  summary,
  sort,
  onSort,
  linkClaims = true,
}: {
  summary: LossSummary;
  sort: LossSummarySort;
  onSort: (key: LossSummarySortKey) => void;
  linkClaims?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <DesktopTable summary={summary} sort={sort} onSort={onSort} linkClaims={linkClaims} />
      <PhoneList summary={summary} sort={sort} onSort={onSort} linkClaims={linkClaims} />
    </div>
  );
}

function ClaimNumber({ claim, link }: { claim: LossSummaryClaim; link: boolean }) {
  const label = claim.claim_number ? (
    <span className="font-mono text-xs">{claim.claim_number}</span>
  ) : (
    <span className="text-xs text-muted-foreground">Number pending</span>
  );
  if (!link) return label;
  return (
    <Link
      to="/claims/$claimId"
      params={{ claimId: claim.id }}
      className="text-navy hover:underline"
    >
      {label}
    </Link>
  );
}

function SortHeader({
  column,
  sort,
  onSort,
}: {
  column: (typeof COLUMNS)[number];
  sort: LossSummarySort;
  onSort: (key: LossSummarySortKey) => void;
}) {
  const active = sort.key === column.key;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={cn("p-3 whitespace-nowrap", column.money ? "text-right" : "text-left")}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide hover:text-navy",
          active && "text-navy",
        )}
      >
        {column.label}
        <Icon className={cn("h-3 w-3", !active && "opacity-40")} aria-hidden />
      </button>
    </th>
  );
}

function TotalCells({ totals }: { totals: LossSummaryTotals }) {
  return (
    <>
      <td className="p-3 text-right whitespace-nowrap">{fmt(totals.paid)}</td>
      <td className="p-3 text-right whitespace-nowrap">{fmt(totals.reserve)}</td>
      <td className="p-3 text-right whitespace-nowrap">{fmt(totals.incurred)}</td>
    </>
  );
}

function DesktopTable({
  summary,
  sort,
  onSort,
  linkClaims,
}: {
  summary: LossSummary;
  sort: LossSummarySort;
  onSort: (key: LossSummarySortKey) => void;
  linkClaims: boolean;
}) {
  return (
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            {COLUMNS.map((column) => (
              <SortHeader key={column.key} column={column} sort={sort} onSort={onSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {summary.years.map((y) => (
            <Fragment key={y.year}>
              {y.lines.map((l) => (
                <Fragment key={l.line}>
                  {l.rows.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="p-3 whitespace-nowrap">{yearLabel(y.year)}</td>
                      <td className="p-3">{l.line}</td>
                      <td className="p-3">{carrierLabel(c)}</td>
                      <td className="p-3 whitespace-nowrap">
                        <ClaimNumber claim={c} link={linkClaims} />
                      </td>
                      <td className="p-3 whitespace-nowrap">{formatDate(c.date_of_loss)}</td>
                      <td className="p-3">
                        <StatusBadge status={statusBucket(c)} />
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">{fmt(paidAmount(c))}</td>
                      <td className="p-3 text-right whitespace-nowrap">{fmt(reserveAmount(c))}</td>
                      <td className="p-3 text-right whitespace-nowrap">{fmt(incurredAmount(c))}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border bg-muted/20 font-medium text-navy">
                    <td className="p-3" colSpan={6}>
                      {yearLabel(y.year)} · {l.line} subtotal ({claimsLabel(l.totals.claims)})
                    </td>
                    <TotalCells totals={l.totals} />
                  </tr>
                </Fragment>
              ))}
              <tr className="border-t border-border bg-navy/5 font-semibold text-navy">
                <td className="p-3" colSpan={6}>
                  {yearLabel(y.year)} subtotal ({claimsLabel(y.totals.claims)})
                </td>
                <TotalCells totals={y.totals} />
              </tr>
            </Fragment>
          ))}
          <tr className="border-t-2 border-navy/30 bg-navy/10 font-bold text-navy">
            <td className="p-3" colSpan={6}>
              Grand total ({claimsLabel(summary.totals.claims)})
            </td>
            <TotalCells totals={summary.totals} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const PHONE_SORTS: { key: LossSummarySortKey; label: string }[] = [
  { key: "year", label: "Year" },
  { key: "line", label: "Line" },
  { key: "date", label: "Date of loss" },
  { key: "status", label: "Status" },
  { key: "paid", label: "Paid" },
  { key: "reserve", label: "Reserve" },
  { key: "incurred", label: "Incurred" },
];

function PhoneTotals({
  label,
  totals,
  strong,
}: {
  label: string;
  totals: LossSummaryTotals;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "px-4 py-3 text-navy",
        strong ? "bg-navy/10 font-bold" : "bg-muted/30 font-medium",
      )}
    >
      <div className="text-sm">
        {label} ({claimsLabel(totals.claims)})
      </div>
      <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
        <span>Paid {fmt(totals.paid)}</span>
        <span>Reserve {fmt(totals.reserve)}</span>
        <span>Incurred {fmt(totals.incurred)}</span>
      </div>
    </div>
  );
}

// Phones: one block per year and line, a short row per claim, and a sort menu
// in place of column headers.
function PhoneList({
  summary,
  sort,
  onSort,
  linkClaims,
}: {
  summary: LossSummary;
  sort: LossSummarySort;
  onSort: (key: LossSummarySortKey) => void;
  linkClaims: boolean;
}) {
  return (
    <div className="md:hidden">
      <div className="flex items-center gap-2 border-b border-border p-3 text-sm">
        <label htmlFor="loss-summary-sort" className="text-muted-foreground">
          Sort by
        </label>
        <select
          id="loss-summary-sort"
          value={sort.key}
          onChange={(e) => onSort(e.target.value as LossSummarySortKey)}
          className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-base"
        >
          {PHONE_SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onSort(sort.key)}
          className="h-10 rounded-md border border-input px-3"
          aria-label={
            sort.dir === "asc"
              ? "Sorted ascending; switch to descending"
              : "Sorted descending; switch to ascending"
          }
        >
          {sort.dir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
        </button>
      </div>
      {summary.years.map((y) => (
        <div key={y.year} className="border-b border-border">
          {y.lines.map((l) => (
            <div key={l.line}>
              <div className="px-4 pt-3 text-xs uppercase tracking-wide text-muted-foreground">
                {yearLabel(y.year)} · {l.line}
              </div>
              <ul className="divide-y divide-border">
                {l.rows.map((c) => (
                  <li key={c.id} className="px-4 py-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <ClaimNumber claim={c} link={linkClaims} />
                      <StatusBadge status={statusBucket(c)} />
                    </div>
                    <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                      <span>{formatDate(c.date_of_loss)}</span>
                      <span>{carrierLabel(c)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <span>Paid {fmt(paidAmount(c))}</span>
                      <span>Reserve {fmt(reserveAmount(c))}</span>
                      <span>Incurred {fmt(incurredAmount(c))}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <PhoneTotals label={`${l.line} subtotal`} totals={l.totals} />
            </div>
          ))}
          <PhoneTotals label={`${yearLabel(y.year)} subtotal`} totals={y.totals} strong />
        </div>
      ))}
      <PhoneTotals label="Grand total" totals={summary.totals} strong />
    </div>
  );
}
