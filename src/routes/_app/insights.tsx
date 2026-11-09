import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useMemo } from "react";
import {
  STATUS_BUCKETS,
  compareYtd,
  openCount,
  statusBucket,
  totalIncurred,
  totalPaid,
} from "@/lib/claim-metrics";
import { CLAIM_STATUS_LABELS } from "@/lib/claim-status";
import { calendarYear, todayIso } from "@/lib/dates";
import {
  DEFAULT_INSIGHTS_MEASURE,
  INSIGHTS_MEASURES,
  INSIGHTS_MEASURE_LABELS,
  insightsChartCards,
  parseInsightsMeasure,
  totalsBy,
  type InsightsMeasure,
} from "@/lib/insights-measure";
import { largestOpenClaims, totalsByCause, totalsByLocation } from "@/lib/insights-breakdowns";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import { LargestOpenClaims } from "@/components/insights/largest-open-claims";
import { overviewQueryOptions } from "@/lib/query-keys";
import { ChartsPlaceholder } from "@/components/insights/chart-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart as LineIcon } from "lucide-react";

// recharts loads only when this page renders its charts (fix 27).
const InsightsCharts = lazy(() => import("@/components/insights/insights-charts"));

export const Route = createFileRoute("/_app/insights")({
  // Optional so plain "/insights" links stay valid; count is the default and
  // is left out of the URL.
  validateSearch: (search: Record<string, unknown>): { measure?: InsightsMeasure } => {
    const measure = parseInsightsMeasure(search.measure);
    return measure === DEFAULT_INSIGHTS_MEASURE ? {} : { measure };
  },
  head: () => ({ meta: [{ title: "Insights | ClaimsQR" }] }),
  component: InsightsPage,
});

// How many claims the "largest open claims" table lists.
const LARGEST_OPEN_LIMIT = 10;

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

function InsightsPage() {
  const getOverview = useServerFn(fetchAgencyOverview);
  const measure = Route.useSearch({ select: (s) => s.measure ?? DEFAULT_INSIGHTS_MEASURE });
  const navigate = useNavigate({ from: Route.fullPath });

  const { data: claims = [], isLoading } = useQuery({
    ...overviewQueryOptions("claims", getOverview),
    select: (overview) => overview.claims,
  });

  const byLob = useMemo(
    () =>
      Array.from(
        totalsBy(claims, (c) => c.line_of_business),
        ([lob, totals]) => ({
          lob,
          ...totals,
        }),
      ),
    [claims],
  );

  const byStatus = useMemo(() => {
    const groups = totalsBy(claims, statusBucket);
    return STATUS_BUCKETS.flatMap((s) => {
      const totals = groups.get(s);
      return totals ? [{ status: s, name: CLAIM_STATUS_LABELS[s], ...totals }] : [];
    });
  }, [claims]);

  const byYear = useMemo(
    () =>
      Array.from(
        totalsBy(claims, (c) => calendarYear(c.date_of_loss)),
        ([year, totals]) => ({
          year,
          ...totals,
        }),
      ).sort((a, b) => a.year - b.year),
    [claims],
  );

  const byCarrier = useMemo(
    () =>
      Array.from(
        totalsBy(claims, (c) => c.carrier || "—"),
        ([carrier, totals]) => ({
          carrier,
          ...totals,
        }),
      ),
    [claims],
  );

  const byCause = useMemo(() => totalsByCause(claims), [claims]);
  const byLocation = useMemo(() => totalsByLocation(claims), [claims]);
  const largest = useMemo(
    () => largestOpenClaims(claims, measure, LARGEST_OPEN_LIMIT),
    [claims, measure],
  );

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Charts show</span>
        <Tabs
          value={measure}
          onValueChange={(value) =>
            navigate({ search: { measure: parseInsightsMeasure(value) }, replace: true })
          }
        >
          <TabsList aria-label="Chart measure">
            {INSIGHTS_MEASURES.map((m) => (
              <TabsTrigger key={m} value={m}>
                {INSIGHTS_MEASURE_LABELS[m]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <Suspense fallback={<ChartsPlaceholder cards={Object.values(insightsChartCards(measure))} />}>
        <InsightsCharts
          measure={measure}
          byLob={byLob}
          byStatus={byStatus}
          byYear={byYear}
          byCarrier={byCarrier}
          byCause={byCause}
          byLocation={byLocation}
        />
      </Suspense>

      <LargestOpenClaims claims={largest} measure={measure} limit={LARGEST_OPEN_LIMIT} />
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
