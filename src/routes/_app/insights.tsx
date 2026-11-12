import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useMemo } from "react";
import { LineChart as LineIcon } from "lucide-react";
import { avgClosedCost, claimTotals } from "@/lib/claim-metrics";
import { formatDate, todayIso } from "@/lib/dates";
import type { ClaimLinkFilter } from "@/lib/insights-breakdowns";
import { INSIGHTS_CARDS } from "@/lib/insights-cards";
import {
  DEFAULT_INSIGHTS_MEASURE,
  INSIGHTS_MEASURES,
  INSIGHTS_MEASURE_LABELS,
  parseInsightsMeasure,
  type InsightsMeasure,
} from "@/lib/insights-measure";
import {
  DEFAULT_INSIGHTS_PERIOD,
  INSIGHTS_PERIOD,
  INSIGHTS_PERIODS,
  INSIGHTS_PERIOD_LABELS,
  claimsInRange,
  currentPolicyTerm,
  parseInsightsPeriod,
  parseIsoDate,
  percentChange,
  priorRange,
  rangeLabel,
  resolvePeriod,
  timeBuckets,
  type DateRange,
  type InsightsPeriod,
} from "@/lib/insights-period";
import { largestOpenClaims } from "@/lib/insights-breakdowns";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import { overviewQueryOptions } from "@/lib/query-keys";
import { ChartsPlaceholder } from "@/components/insights/chart-card";
import { LargestOpenClaims } from "@/components/insights/largest-open-claims";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// recharts loads only when this page renders its charts (fix 27).
const InsightsCharts = lazy(() => import("@/components/insights/insights-charts"));

interface InsightsSearch {
  measure?: InsightsMeasure;
  /** The period all charts share (fix 45); all time when missing. */
  period?: InsightsPeriod;
  /** Custom period bounds, "YYYY-MM-DD". */
  from?: string;
  to?: string;
  /** "Compare to prior year". */
  compare?: true;
}

export const Route = createFileRoute("/_app/insights")({
  // Every value is optional so plain "/insights" links stay valid; defaults
  // are left out of the URL.
  validateSearch: (search: Record<string, unknown>): InsightsSearch => {
    const result: InsightsSearch = {};
    const measure = parseInsightsMeasure(search.measure);
    if (measure !== DEFAULT_INSIGHTS_MEASURE) result.measure = measure;
    const period = parseInsightsPeriod(search.period);
    if (period !== DEFAULT_INSIGHTS_PERIOD) result.period = period;
    if (period === INSIGHTS_PERIOD.custom) {
      const from = parseIsoDate(search.from);
      const to = parseIsoDate(search.to);
      if (from) result.from = from;
      if (to) result.to = to;
    }
    if (search.compare === true || search.compare === "true" || search.compare === 1) {
      result.compare = true;
    }
    return result;
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
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const measure = search.measure ?? DEFAULT_INSIGHTS_MEASURE;
  const period = search.period ?? DEFAULT_INSIGHTS_PERIOD;

  // "all" brings the policies too, for the policy-year period.
  const { data, isLoading } = useQuery(overviewQueryOptions("all", getOverview));
  const claims = useMemo(() => data?.claims ?? [], [data]);
  const policies = useMemo(() => data?.policies ?? [], [data]);

  const today = todayIso();
  const policyTerm = useMemo(() => currentPolicyTerm(policies, today), [policies, today]);
  const range = useMemo(
    () => resolvePeriod({ period, from: search.from, to: search.to, today, policies }),
    [period, search.from, search.to, today, policies],
  );
  const prior = range ? priorRange(range) : null;
  const compare = !!search.compare && prior !== null;

  const current = useMemo(() => claimsInRange(claims, range), [claims, range]);
  const previous = useMemo(() => (prior ? claimsInRange(claims, prior) : null), [claims, prior]);
  const buckets = useMemo(() => timeBuckets(range, current), [range, current]);

  const totals = useMemo(() => claimTotals(current), [current]);
  const priorTotals = useMemo(() => (previous ? claimTotals(previous) : null), [previous]);
  const avgClosed = avgClosedCost(current);
  const priorAvgClosed = previous ? avgClosedCost(previous) : null;
  const largest = useMemo(
    () => largestOpenClaims(current, measure, LARGEST_OPEN_LIMIT),
    [current, measure],
  );

  const setSearch = (patch: Partial<InsightsSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const onOpen = (filter: ClaimLinkFilter, within: DateRange | null) =>
    navigate({
      to: "/claims",
      search: { ...filter, from: within?.from, to: within?.to },
    });

  const periodText = rangeLabel(range, (d) => formatDate(d));
  const change = (now: number, before: number | null | undefined) => {
    if (!prior || before === null || before === undefined)
      return { text: periodText, tone: "neutral" as const };
    const pct = percentChange(now, before);
    if (pct === null) return { text: `No prior-year figure to compare`, tone: "neutral" as const };
    if (pct === 0) return { text: "No change vs prior year", tone: "neutral" as const };
    return {
      text: `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}% vs prior year`,
      tone: pct > 0 ? ("up" as const) : ("down" as const),
    };
  };

  const periodOptionLabel = (p: InsightsPeriod) =>
    p === INSIGHTS_PERIOD.policy
      ? policyTerm
        ? `Policy year (${formatDate(policyTerm.from)} – ${formatDate(policyTerm.to)})`
        : "Policy year (none in force)"
      : INSIGHTS_PERIOD_LABELS[p];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-navy flex items-center gap-2">
          <LineIcon className="h-6 w-6 text-gold" /> Insights
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visual breakdown of claims directly from your data. Select any bar, point or slice to see
          those claims.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="insights-period"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Period (date of loss)
          </label>
          <select
            id="insights-period"
            value={period}
            onChange={(e) => {
              const next = parseInsightsPeriod(e.target.value);
              setSearch({
                period: next === DEFAULT_INSIGHTS_PERIOD ? undefined : next,
                from:
                  next === INSIGHTS_PERIOD.custom
                    ? (search.from ?? `${today.slice(0, 4)}-01-01`)
                    : undefined,
                to: next === INSIGHTS_PERIOD.custom ? (search.to ?? today) : undefined,
                compare: next === INSIGHTS_PERIOD.all ? undefined : search.compare,
              });
            }}
            className="h-10 md:h-9 rounded-md border border-input bg-background px-3 text-base md:text-sm"
          >
            {INSIGHTS_PERIODS.map((p) => (
              <option key={p} value={p} disabled={p === INSIGHTS_PERIOD.policy && !policyTerm}>
                {periodOptionLabel(p)}
              </option>
            ))}
          </select>
        </div>

        {period === INSIGHTS_PERIOD.custom && (
          <div className="flex gap-2">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="insights-from"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                From
              </label>
              <Input
                id="insights-from"
                type="date"
                value={search.from ?? ""}
                max={search.to}
                onChange={(e) => setSearch({ from: parseIsoDate(e.target.value) ?? undefined })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="insights-to"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                To
              </label>
              <Input
                id="insights-to"
                type="date"
                value={search.to ?? ""}
                min={search.from}
                onChange={(e) => setSearch({ to: parseIsoDate(e.target.value) ?? undefined })}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Charts show</span>
          <Tabs
            value={measure}
            onValueChange={(value) => {
              const next = parseInsightsMeasure(value);
              setSearch({ measure: next === DEFAULT_INSIGHTS_MEASURE ? undefined : next });
            }}
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

        <label className="flex items-center gap-2 text-sm lg:h-9">
          <Switch
            checked={compare}
            disabled={!prior}
            onCheckedChange={(on) => setSearch({ compare: on ? true : undefined })}
            aria-describedby="compare-help"
          />
          <span>Compare to prior year</span>
          <span id="compare-help" className="sr-only">
            {prior
              ? `Adds ${rangeLabel(prior, (d) => formatDate(d))} beside every chart`
              : "Pick a period other than All time to compare"}
          </span>
        </label>
      </div>

      {range === null && period !== INSIGHTS_PERIOD.all && (
        <p className="text-sm text-amber-700">
          {period === INSIGHTS_PERIOD.policy
            ? "No policy is in force today, so all claims are shown."
            : "Pick a start and end date. Until then all claims are shown."}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Stat
          label="Claims"
          value={String(totals.claims)}
          {...change(totals.claims, priorTotals?.claims)}
        />
        <Stat label="Open Claims" value={String(totals.open)} sub={periodText} />
        <Stat label="Closed Claims" value={String(totals.closed)} sub={periodText} />
        <Stat
          label="Total Paid"
          value={fmt(totals.paid)}
          {...change(totals.paid, priorTotals?.paid)}
        />
        <Stat
          label="Total Incurred"
          value={fmt(totals.incurred)}
          {...change(totals.incurred, priorTotals?.incurred)}
        />
        <Stat
          label="Avg Cost per Closed Claim"
          value={avgClosed === null ? "—" : fmt(avgClosed)}
          {...(avgClosed === null
            ? { text: "No closed claims", tone: "neutral" as const }
            : change(avgClosed, priorAvgClosed))}
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <Suspense fallback={<ChartsPlaceholder cards={INSIGHTS_CARDS} measure={measure} />}>
        <InsightsCharts
          measure={measure}
          claims={current}
          priorClaims={compare ? previous : null}
          range={range}
          buckets={buckets}
          onOpen={onOpen}
        />
      </Suspense>

      <LargestOpenClaims claims={largest} measure={measure} limit={LARGEST_OPEN_LIMIT} />
    </div>
  );
}

function Stat({
  label,
  value,
  text,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  text?: string;
  sub?: string;
  tone?: "up" | "down" | "neutral";
}) {
  const toneClass =
    tone === "up" ? "text-red-600" : tone === "down" ? "text-emerald-600" : "text-muted-foreground";
  const line = text ?? sub;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-navy mt-1">{value}</div>
      {line && <div className={`text-xs mt-1 font-medium ${toneClass}`}>{line}</div>}
    </div>
  );
}
