import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  incurredAmount,
  paidAmount,
  statusBucket,
  totalIncurred,
  totalPaid,
} from "@/lib/claim-metrics";
import { formatDate, todayIso } from "@/lib/dates";
import { groupLossSummary, statusCountsLabel } from "@/lib/exports/loss-summary-export";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import { overviewQueryOptions } from "@/lib/query-keys";
import { BarChart3, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { LossSummaryExport } from "@/components/reports/loss-summary-export";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

// The "Loss Summary" tab on /reports (formerly the Analytics page).
export function LossSummary() {
  const [search, setSearch] = useState("");
  const getOverview = useServerFn(fetchAgencyOverview);

  const { data: claims = [], isLoading } = useQuery({
    ...overviewQueryOptions("claims", getOverview),
    select: (overview) => overview.claims,
  });

  // Shared with the PDF / Excel export, so the files carry the same groups and totals.
  const groups = useMemo(() => groupLossSummary(claims, search), [claims, search]);

  const valued = formatDate(todayIso());

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-navy flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-gold" /> Loss Summary
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Loss run summary report by year and line of business.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search year, LOB, carrier…"
              className="pl-9 w-full sm:w-64"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <LossSummaryExport groups={groups} />
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No claim data available for analytics yet.</p>
      )}

      <div className="space-y-6">
        {groups.map((g) => {
          const totalClaims = g.rows.length;
          const paid = totalPaid(g.rows);
          const incurred = totalIncurred(g.rows);
          return (
            <section
              key={`${g.year}-${g.lob}-${g.carrier}`}
              className="rounded-lg border border-border bg-card overflow-hidden"
            >
              <div className="px-5 py-3 border-b border-border bg-muted/30 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">LOB:</span>{" "}
                  <span className="font-semibold text-navy">{g.lob}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Year:</span>{" "}
                  <span className="font-semibold text-navy">{g.year || "No date"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Carrier:</span>{" "}
                  <span className="font-semibold text-navy">{g.carrier}</span>
                </div>
                <div className="ml-auto text-xs text-muted-foreground">Valued {valued}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left p-3">Claim #</th>
                      <th className="text-left p-3">Status</th>
                      <th className="text-right p-3">Paid</th>
                      <th className="text-right p-3">Incurred</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="p-3 whitespace-nowrap">
                          {r.claim_number ? (
                            <span className="font-mono text-xs">{r.claim_number}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Number pending</span>
                          )}
                        </td>
                        <td className="p-3">
                          <StatusBadge status={statusBucket(r)} />
                        </td>
                        <td className="p-3 text-right whitespace-nowrap">{fmt(paidAmount(r))}</td>
                        <td className="p-3 text-right whitespace-nowrap">
                          {fmt(incurredAmount(r))}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border bg-muted/20 font-semibold text-navy">
                      <td className="p-3 whitespace-nowrap">Total ({totalClaims})</td>
                      <td className="p-3 text-xs font-medium">{statusCountsLabel(g.rows)}</td>
                      <td className="p-3 text-right whitespace-nowrap">{fmt(paid)}</td>
                      <td className="p-3 text-right whitespace-nowrap">{fmt(incurred)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
