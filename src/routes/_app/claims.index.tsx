import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { STATUS_BUCKETS, paidAmount, reserveAmount } from "@/lib/claim-metrics";
import { CLAIM_STATUS_LABELS } from "@/lib/claim-status";
import { carrierShortName } from "@/lib/carriers";
import {
  DEFAULT_CLAIM_SORT,
  defaultSortDir,
  filterClaims,
  nextSort,
  pageRangeLabel,
  paginate,
  parseClaimsSearch,
  sortClaims,
  type ClaimSortKey,
  type SortDir,
} from "@/lib/claims-list";
import { formatDate } from "@/lib/dates";
import {
  claimWaitingOn,
  daysLabel,
  daysSince,
  lastUpdateAt,
  waitingOnLabel,
} from "@/lib/waiting-on";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import type { AgencyClaim } from "@/lib/overview.types";
import { overviewQueryOptions } from "@/lib/query-keys";
import { ClaimFiltersControl } from "@/components/claims/claim-filters";
import { ExportMenu } from "@/components/claims/export-menu";
import { SavedViewsBar } from "@/components/claims/saved-views-bar";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";

export const Route = createFileRoute("/_app/claims/")({
  // status, q, sort, dir and page live in the URL (fix 24), e.g. /claims?status=open,
  // and so do the line, year, carrier and location filters (fix 31).
  validateSearch: parseClaimsSearch,
  head: () => ({ meta: [{ title: "Claims | ClaimsQR" }] }),
  component: ClaimsList,
});

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const COLUMNS: { key: ClaimSortKey; label: string; numeric?: boolean }[] = [
  { key: "date", label: "Date of Loss" },
  { key: "type", label: "Type" },
  { key: "carrier", label: "Carrier" },
  { key: "status", label: "Status" },
  { key: "number", label: "Claim #" },
  { key: "adjuster", label: "Adjuster" },
  { key: "paid", label: "Paid", numeric: true },
  { key: "reserve", label: "Reserve", numeric: true },
  { key: "closed", label: "Closed" },
  { key: "waiting", label: "Waiting on" },
  { key: "updated", label: "Days since update", numeric: true },
];

function ClaimsList() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const sort = search.sort ?? DEFAULT_CLAIM_SORT;
  const dir = search.dir ?? defaultSortDir(sort);

  // The box updates the URL as you type; it also follows the URL on back/forward.
  const [query, setQuery] = useState(search.q ?? "");
  useEffect(() => setQuery(search.q ?? ""), [search.q]);

  const getOverview = useServerFn(fetchAgencyOverview);
  const { data: claims = [], isLoading } = useQuery({
    ...overviewQueryOptions("claims", getOverview),
    select: (overview) => overview.claims,
  });

  const filtered = filterClaims(claims, search);
  const page = paginate(sortClaims(filtered, sort, dir), search.page);
  // One clock for every row's "Days since update".
  const now = new Date();

  const onSearch = (value: string) => {
    setQuery(value);
    navigate({
      search: (prev) => ({ ...prev, q: value.trim() ? value : undefined, page: undefined }),
      replace: true,
    });
  };

  const onSort = (key: ClaimSortKey) => {
    const next = nextSort({ sort, dir }, key);
    navigate({ search: (prev) => ({ ...prev, ...next, page: undefined }) });
  };

  const goToPage = (n: number) =>
    navigate({ search: (prev) => ({ ...prev, page: n > 1 ? n : undefined }) });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-navy">Claims</h1>
          <p className="text-sm text-muted-foreground mt-1">All reported claims.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {([undefined, ...STATUS_BUCKETS] as const).map((s) => {
            const selected = search.status === s;
            return (
              <Button
                key={s ?? "all"}
                size="sm"
                variant={selected ? "default" : "outline"}
                className={selected ? "bg-navy hover:bg-navy/90 text-navy-foreground" : ""}
                aria-pressed={selected}
                onClick={() =>
                  navigate({ search: (prev) => ({ ...prev, status: s, page: undefined }) })
                }
              >
                {s === undefined ? "All" : CLAIM_STATUS_LABELS[s]}
              </Button>
            );
          })}
          <ExportMenu claims={claims} search={search} />
        </div>
      </div>

      {/* Saved views (fix 31): "All claims" plus the user's own views. */}
      <SavedViewsBar search={search} onApply={(filters) => navigate({ search: filters })} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-0 md:flex-none md:w-full md:max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search claim #, claimant, driver, vehicle, location…"
            aria-label="Search claims"
            className="pl-9"
          />
        </div>
        <ClaimFiltersControl
          claims={claims}
          filters={search}
          onChange={(next) =>
            navigate({ search: (prev) => ({ ...prev, ...next, page: undefined }) })
          }
        />
      </div>

      <MobileSort
        sort={sort}
        dir={dir}
        onChange={(next) => navigate({ search: (prev) => ({ ...prev, ...next, page: undefined }) })}
      />

      {/* Phones get cards (fix 23); the table starts at md. */}
      <ul className="md:hidden space-y-3">
        {isLoading && (
          <li className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            Loading…
          </li>
        )}
        {!isLoading && page.total === 0 && (
          <li className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No claims found.
          </li>
        )}
        {page.rows.map((c) => (
          <li key={c.id}>
            <ClaimCard claim={c} now={now} />
          </li>
        ))}
      </ul>

      <div className="hidden md:block rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {COLUMNS.map((col) => {
                const active = col.key === sort;
                const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
                    className={cn("p-0", col.numeric ? "text-right" : "text-left")}
                  >
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      className={cn(
                        "w-full inline-flex items-center gap-1 p-3 uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
                        col.numeric && "justify-end",
                        active && "text-foreground",
                      )}
                    >
                      {col.label}
                      <Icon className={cn("h-3 w-3", !active && "opacity-40")} aria-hidden />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={COLUMNS.length} className="p-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && page.total === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="p-6 text-center text-muted-foreground">
                  No claims found.
                </td>
              </tr>
            )}
            {page.rows.map((c) => (
              <ClaimRow key={c.id} claim={c} now={now} />
            ))}
          </tbody>
        </table>
      </div>

      {page.total > 0 && (
        <div className="flex items-center justify-between gap-4 text-sm">
          <p className="text-muted-foreground" aria-live="polite">
            {pageRangeLabel(page)}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page.page <= 1}
              onClick={() => goToPage(page.page - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page.page >= page.pageCount}
              onClick={() => goToPage(page.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ClaimCard({ claim: c, now }: { claim: AgencyClaim; now: Date }) {
  const carrierShort = carrierShortName(c.carrier);
  return (
    <Link
      to="/claims/$claimId"
      params={{ claimId: c.id }}
      className="block rounded-lg border border-border bg-card p-4 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Date of loss</p>
          <p className="font-medium text-navy">{formatDate(c.date_of_loss)}</p>
        </div>
        <StatusBadge status={c.status} />
      </div>
      <p className="mt-2 text-sm font-medium truncate">{c.claim_type}</p>
      {c.line_of_business && c.line_of_business !== c.claim_type && (
        <p className="text-xs text-muted-foreground truncate">{c.line_of_business}</p>
      )}
      <div className="mt-1 flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span className="truncate" title={c.carrier ?? undefined}>
          {carrierShort ?? "—"}
        </span>
        {c.claim_number ? (
          <span className="font-mono text-xs truncate">{c.claim_number}</span>
        ) : (
          <span className="text-xs italic shrink-0">Number pending</span>
        )}
      </div>
      {/* Everything the desktop row shows, so phones see the same (CLAUDE.md). */}
      <dl className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <CardField label="Paid" value={fmtMoney(paidAmount(c))} numeric />
        <CardField label="Reserve" value={fmtMoney(reserveAmount(c))} numeric />
        <CardField label="Adjuster" value={c.adjuster_name ?? "—"} />
        <CardField label="Closed" value={c.closed_date ? formatDate(c.closed_date) : "—"} />
        <CardField label="Waiting on" value={waitingOnLabel(claimWaitingOn(c))} />
        <CardField label="Days since update" value={daysLabel(daysSince(lastUpdateAt(c), now))} />
      </dl>
    </Link>
  );
}

function CardField({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("truncate", numeric && "tabular-nums font-medium")}>{value}</dd>
    </div>
  );
}

// Phones have no column headers to tap, so sorting is a dropdown plus a
// direction button, driving the same ?sort=&dir= as the desktop headers.
function MobileSort({
  sort,
  dir,
  onChange,
}: {
  sort: ClaimSortKey;
  dir: SortDir;
  onChange: (next: { sort: ClaimSortKey; dir: SortDir }) => void;
}) {
  const DirIcon = dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <div className="md:hidden flex items-center gap-2">
      <label htmlFor="claims-sort" className="text-sm text-muted-foreground shrink-0">
        Sort by
      </label>
      <select
        id="claims-sort"
        value={sort}
        onChange={(e) => {
          const key = e.target.value as ClaimSortKey;
          onChange({ sort: key, dir: defaultSortDir(key) });
        }}
        className="flex-1 min-w-0 h-10 rounded-md border border-input bg-background px-3 text-base"
      >
        {COLUMNS.map((col) => (
          <option key={col.key} value={col.key}>
            {col.label}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="outline"
        className="h-10 shrink-0"
        onClick={() => onChange({ sort, dir: dir === "asc" ? "desc" : "asc" })}
        aria-label={
          dir === "asc" ? "Ascending, tap for descending" : "Descending, tap for ascending"
        }
      >
        <DirIcon className="h-4 w-4" aria-hidden />
        {dir === "asc" ? "Ascending" : "Descending"}
      </Button>
    </div>
  );
}

// Every cell is a real link to the claim, so a click anywhere in the row opens
// it and Ctrl/Cmd/middle-click opens a new tab. Only the first link is in the
// tab order, so keyboard users get one stop per row.
function ClaimRow({ claim: c, now }: { claim: AgencyClaim; now: Date }) {
  const cell = (content: React.ReactNode, className?: string, first = false) => (
    <td className="p-0">
      <Link
        to="/claims/$claimId"
        params={{ claimId: c.id }}
        tabIndex={first ? undefined : -1}
        aria-label={
          first
            ? `Claim ${c.claim_number ?? "number pending"}, loss on ${formatDate(c.date_of_loss)}`
            : undefined
        }
        className={cn(
          "block p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          className,
        )}
      >
        {content}
      </Link>
    </td>
  );
  const carrierShort = carrierShortName(c.carrier);

  return (
    <tr className="border-t border-border hover:bg-muted/30 focus-within:bg-muted/30">
      {cell(formatDate(c.date_of_loss), undefined, true)}
      {cell(c.claim_type)}
      {cell(<span title={c.carrier ?? undefined}>{carrierShort ?? "—"}</span>)}
      {cell(<StatusBadge status={c.status} />)}
      {cell(c.claim_number ?? "—", "font-mono text-xs")}
      {cell(c.adjuster_name ?? "—")}
      {cell(fmtMoney(paidAmount(c)), "text-right tabular-nums")}
      {cell(fmtMoney(reserveAmount(c)), "text-right tabular-nums")}
      {cell(formatDate(c.closed_date), "text-muted-foreground")}
      {cell(waitingOnLabel(claimWaitingOn(c)))}
      {cell(daysLabel(daysSince(lastUpdateAt(c), now)), "text-right tabular-nums")}
    </tr>
  );
}
