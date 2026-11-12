import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { CLIENT_USER_ROLE } from "@/lib/client-users";
import { formatDate, todayIso } from "@/lib/dates";
import {
  DEFAULT_LOSS_SUMMARY_SORT,
  buildLossSummary,
  filterLossSummary,
  lossSummaryFilterLabel,
  lossSummaryOptions,
  nextLossSummarySort,
  yearLabel,
  type LossSummaryFilters,
  type LossSummarySort,
} from "@/lib/loss-summary";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import { overviewQueryOptions } from "@/lib/query-keys";
import { createLossSummaryShare } from "@/lib/shared-reports.functions";
import { SHARED_REPORT_KIND } from "@/lib/shared-reports";
import { LossSummaryExport } from "@/components/reports/loss-summary-export";
import { LossSummaryTable } from "@/components/reports/loss-summary-table";
import { ShareReportButton, SharedLinksList } from "@/components/reports/share-links";

const ALL = "";

const selectClass =
  "h-10 md:h-9 w-full sm:w-auto rounded-md border border-input bg-background px-3 text-base md:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// The "Loss Summary" tab on /reports (fix 44): one table by year and line,
// filtered by client (agency), year, line and carrier.
export function LossSummary() {
  const { role, clientId: ownClientId, clientRole } = useAuth();
  const isAgency = role === "agency_admin";
  const getOverview = useServerFn(fetchAgencyOverview);
  const share = useServerFn(createLossSummaryShare);

  const { data: claims = [], isLoading } = useQuery({
    ...overviewQueryOptions("claims", getOverview),
    select: (overview) => overview.claims,
  });

  const [clientId, setClientId] = useState(ALL);
  const [filters, setFilters] = useState<LossSummaryFilters>({});
  const [sort, setSort] = useState<LossSummarySort>(DEFAULT_LOSS_SUMMARY_SORT);

  // Agency admins see every client's claims; pick one to report on (and share).
  const clients = useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of claims) byId.set(c.client_id, c.client_name || "Unnamed client");
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
  }, [claims]);
  const clientClaims = useMemo(
    () => (clientId ? claims.filter((c) => c.client_id === clientId) : claims),
    [claims, clientId],
  );
  const options = useMemo(() => lossSummaryOptions(clientClaims), [clientClaims]);
  const summary = useMemo(
    () => buildLossSummary(filterLossSummary(clientClaims, filters), sort),
    [clientClaims, filters, sort],
  );

  // The client the report is about: the one picked, or a client user's own.
  const reportClientId = isAgency ? clientId || null : ownClientId;
  const reportClientName = reportClientId
    ? (clients.find(([id]) => id === reportClientId)?.[1] ?? undefined)
    : undefined;
  const canShare = isAgency || clientRole === CLIENT_USER_ROLE.clientAdmin;
  const filterLabel = lossSummaryFilterLabel(filters);

  const set = (patch: Partial<LossSummaryFilters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-navy flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-gold" /> Loss Summary
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every claim by year and line of business, valued as of {formatDate(todayIso())}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LossSummaryExport
            summary={summary}
            info={{ valuedAsOf: todayIso(), client: reportClientName, filters: filterLabel }}
          />
          {canShare && (
            <ShareReportButton
              title="Share this Loss Summary"
              description={`A read-only copy of ${reportClientName ?? "this report"} (${filterLabel}) as of today.`}
              disabled={!reportClientId || summary.totals.claims === 0}
              disabledReason="Pick a client to share their Loss Summary"
              createLink={(days) =>
                share({ data: { clientId: reportClientId as string, filters, days } })
              }
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2">
        {isAgency && clients.length > 1 && (
          <select
            aria-label="Client"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setFilters({});
            }}
            className={selectClass}
          >
            <option value={ALL}>All clients</option>
            {clients.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Year of loss"
          value={filters.year === undefined ? ALL : String(filters.year)}
          onChange={(e) =>
            set({ year: e.target.value === ALL ? undefined : Number(e.target.value) })
          }
          className={selectClass}
        >
          <option value={ALL}>All years</option>
          {options.years.map((y) => (
            <option key={y} value={y}>
              {yearLabel(y)}
            </option>
          ))}
        </select>
        <select
          aria-label="Line of business"
          value={filters.line ?? ALL}
          onChange={(e) => set({ line: e.target.value || undefined })}
          className={selectClass}
        >
          <option value={ALL}>All lines</option>
          {options.lines.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="Carrier"
          value={filters.carrier ?? ALL}
          onChange={(e) => set({ carrier: e.target.value || undefined })}
          className={selectClass}
        >
          <option value={ALL}>All carriers</option>
          {options.carriers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && summary.totals.claims === 0 ? (
        <p className="text-sm text-muted-foreground">No claims match these filters.</p>
      ) : (
        !isLoading && (
          <LossSummaryTable
            summary={summary}
            sort={sort}
            onSort={(key) => setSort((s) => nextLossSummarySort(s, key))}
          />
        )
      )}

      {canShare && (
        <SharedLinksList
          kind={SHARED_REPORT_KIND.lossSummary}
          clientId={isAgency ? clientId || undefined : (ownClientId ?? undefined)}
        />
      )}
    </div>
  );
}
