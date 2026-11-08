import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useMemo } from "react";
import {
  STATUS_BUCKETS,
  compareYtd,
  countByStatus,
  openCount,
  totalIncurred,
  totalPaid,
} from "@/lib/claim-metrics";
import { CLAIM_STATUS_LABELS } from "@/lib/claim-status";
import { calendarYear, todayIso } from "@/lib/dates";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import { overviewQueryOptions } from "@/lib/query-keys";
import { ChartsPlaceholder, INSIGHTS_CHART_CARDS } from "@/components/insights/chart-card";
import { LineChart as LineIcon } from "lucide-react";

// recharts loads only when this page renders its charts (fix 27).
const InsightsCharts = lazy(() => import("@/components/insights/insights-charts"));

export const Route = createFileRoute("/_app/insights")({
  head: () => ({ meta: [{ title: "Insights | ClaimsQR" }] }),
  component: InsightsPage,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function InsightsPage() {
  const getOverview = useServerFn(fetchAgencyOverview);

  const { data: claims = [], isLoading } = useQuery({
    ...overviewQueryOptions("claims", getOverview),
    select: (overview) => overview.claims,
  });

  const byLob = useMemo(() => {
    const m = new Map<string, { lob: string; count: number; paid: number }>();
    for (const c of claims) {
      const k = c.line_of_business;
      const r = m.get(k) ?? { lob: k, count: 0, paid: 0 };
      r.count += 1;
      r.paid += Number(c.paid_amount ?? 0);
      m.set(k, r);
    }
    return Array.from(m.values());
  }, [claims]);

  const byStatus = useMemo(() => {
    const counts = countByStatus(claims);
    return STATUS_BUCKETS.filter((s) => counts[s] > 0).map((s) => ({
      status: s,
      name: CLAIM_STATUS_LABELS[s],
      value: counts[s],
    }));
  }, [claims]);

  const byYear = useMemo(() => {
    const m = new Map<number, { year: number; count: number; paid: number }>();
    for (const c of claims) {
      const y = calendarYear(c.date_of_loss);
      if (y === null) continue;
      const r = m.get(y) ?? { year: y, count: 0, paid: 0 };
      r.count += 1;
      r.paid += Number(c.paid_amount ?? 0);
      m.set(y, r);
    }
    return Array.from(m.values()).sort((a, b) => a.year - b.year);
  }, [claims]);

  const byCarrier = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of claims) {
      const k = c.carrier || "—";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).map(([carrier, count]) => ({ carrier, count }));
  }, [claims]);

  const totals = useMemo(() => {
    return {
      paid: totalPaid(claims),
      incurred: totalIncurred(claims),
      open: openCount(claims),
      total: claims.length,
      ytd: compareYtd(claims, todayIso()),
    };
  }, [claims]);

  const period = `YTD vs same period ${totals.ytd.previousYear}`;
  const change = (pct: number | null) => {
    if (pct === null) return `No comparison for ${period}`;
    if (pct === 0) return `No change ${period}`;
    return `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}% ${period}`;
  };
  const tone = (pct: number | null) => (!pct ? "neutral" : pct > 0 ? "up" : "down");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-navy flex items-center gap-2">
          <LineIcon className="h-6 w-6 text-gold" /> Insights
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visual breakdown of claims directly from your data.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Stat label="Total Claims" value={String(totals.total)} sub="All time" />
        <Stat
          label="Claims Year to Date"
          value={String(totals.ytd.currentYtd)}
          sub={change(totals.ytd.countChange)}
          subTone={tone(totals.ytd.countChange)}
        />
        <Stat label="Open Claims" value={String(totals.open)} />
        <Stat label="Total Paid" value={fmt(totals.paid)} sub="All time" />
        <Stat label="Total Incurred" value={fmt(totals.incurred)} sub="All time, paid + reserve" />
        <Stat
          label="Avg Cost per Closed Claim, YTD"
          value={totals.ytd.avgClosedYtd === null ? "—" : fmt(totals.ytd.avgClosedYtd)}
          sub={`${change(totals.ytd.avgClosedChange)}. Open claims still developing.`}
          subTone={tone(totals.ytd.avgClosedChange)}
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <Suspense fallback={<ChartsPlaceholder cards={Object.values(INSIGHTS_CHART_CARDS)} />}>
        <InsightsCharts byLob={byLob} byStatus={byStatus} byYear={byYear} byCarrier={byCarrier} />
      </Suspense>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  subTone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: "up" | "down" | "neutral";
}) {
  const toneClass =
    subTone === "up"
      ? "text-red-600"
      : subTone === "down"
        ? "text-emerald-600"
        : "text-muted-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-navy mt-1">{value}</div>
      {sub && <div className={`text-xs mt-1 font-medium ${toneClass}`}>{sub}</div>}
    </div>
  );
}
