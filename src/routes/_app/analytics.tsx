import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  STATUS_BUCKETS,
  countByStatus,
  incurredAmount,
  paidAmount,
  statusBucket,
  totalIncurred,
  totalPaid,
} from "@/lib/claim-metrics";
import { CLAIM_STATUS_LABELS } from "@/lib/claim-status";
import { calendarYear, formatDate, todayIso } from "@/lib/dates";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import { overviewQueryOptions } from "@/lib/query-keys";
import type { AgencyClaim } from "@/lib/overview.types";
import { BarChart3, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_app/analytics")({
  component: AnalyticsPage,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function AnalyticsPage() {
  const [search, setSearch] = useState("");
  const getOverview = useServerFn(fetchAgencyOverview);

  const { data: claims = [], isLoading } = useQuery({
    ...overviewQueryOptions("claims", getOverview),
    select: (overview) => overview.claims,
  });

  const groups = useMemo(() => {
    const map = new Map<string, { year: number; lob: string; carrier: string; rows: AgencyClaim[] }>();
    for (const c of claims) {
      const year = calendarYear(c.date_of_loss) ?? 0;
      const lob = c.line_of_business;
      const carrier = c.carrier || "—";
      const key = `${year}|${lob}|${carrier}`;
      if (!map.has(key)) map.set(key, { year, lob, carrier, rows: [] });
      map.get(key)!.rows.push(c);
    }
    const arr = Array.from(map.values()).sort((a, b) =>
      b.year - a.year || a.lob.localeCompare(b.lob) || a.carrier.localeCompare(b.carrier)
    );
    const term = search.trim().toLowerCase();
    if (!term) return arr;
    return arr.filter(
      (g) =>
        (g.year ? String(g.year) : "no date").includes(term) ||
        g.lob.toLowerCase().includes(term) ||
        g.carrier.toLowerCase().includes(term)
    );
  }, [claims, search]);

  const valued = formatDate(todayIso());

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-navy flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-gold" /> Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Loss run summary report by year and line of business.
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search year, LOB, carrier…"
            className="pl-9 w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No claim data available for analytics yet.</p>
      )}

      <div className="space-y-6">
        {groups.map((g) => {
          const totalClaims = g.rows.length;
          const counts = countByStatus(g.rows);
          const paid = totalPaid(g.rows);
          const incurred = totalIncurred(g.rows);
          return (
            <section key={`${g.year}-${g.lob}-${g.carrier}`} className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/30 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <div><span className="text-muted-foreground">LOB:</span> <span className="font-semibold text-navy">{g.lob}</span></div>
                <div><span className="text-muted-foreground">Year:</span> <span className="font-semibold text-navy">{g.year || "No date"}</span></div>
                <div><span className="text-muted-foreground">Carrier:</span> <span className="font-semibold text-navy">{g.carrier}</span></div>
                <div className="ml-auto text-xs text-muted-foreground">Valued {valued}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left p-3">Claim #</th>
                      {STATUS_BUCKETS.map((s) => (
                        <th key={s} className="text-center p-3">
                          {CLAIM_STATUS_LABELS[s]}
                        </th>
                      ))}
                      <th className="text-right p-3">Paid</th>
                      <th className="text-right p-3">Incurred</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="p-3 font-mono text-xs">{r.claim_number ?? "—"}</td>
                        {STATUS_BUCKETS.map((s) => (
                          <td key={s} className="p-3 text-center">{statusBucket(r) === s ? 1 : 0}</td>
                        ))}
                        <td className="p-3 text-right">{fmt(paidAmount(r))}</td>
                        <td className="p-3 text-right">{fmt(incurredAmount(r))}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border bg-muted/20 font-semibold text-navy">
                      <td className="p-3">Total ({totalClaims})</td>
                      {STATUS_BUCKETS.map((s) => (
                        <td key={s} className="p-3 text-center">{counts[s]}</td>
                      ))}
                      <td className="p-3 text-right">{fmt(paid)}</td>
                      <td className="p-3 text-right">{fmt(incurred)}</td>
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
