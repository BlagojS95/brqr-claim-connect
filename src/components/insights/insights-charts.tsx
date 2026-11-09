// The only module that imports recharts. The Insights page loads it with
// React.lazy, so the charting library stays out of every other chunk.

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import type { ClaimStatus } from "@/lib/claim-status";
import {
  INSIGHTS_MEASURE_LABELS,
  insightsChartCards,
  isMoneyMeasure,
  type InsightsMeasure,
  type MeasureTotals,
} from "@/lib/insights-measure";
import { NOT_GIVEN, topRows, type BreakdownRow } from "@/lib/insights-breakdowns";
import { NEUTRAL_SERIES_COLOR, STATUS_COLORS, seriesColor } from "@/lib/status-colors";
import { CHART_HEIGHT, ChartCard, ChartGrid } from "./chart-card";

export interface InsightsChartData {
  measure: InsightsMeasure;
  byLob: (MeasureTotals & { lob: string })[];
  byStatus: (MeasureTotals & { status: ClaimStatus; name: string })[];
  byYear: (MeasureTotals & { year: number })[];
  byCarrier: (MeasureTotals & { carrier: string })[];
  byCause: BreakdownRow[];
  byLocation: BreakdownRow[];
}

// Bars per chart before the rest are added up into one "All other" bar.
const MAX_CAUSE_BARS = 12;
const MAX_LOCATION_BARS = 10;
const OTHER_CAUSES = "All other causes";
const OTHER_LOCATIONS = "All other locations";

// Long names would squeeze the bars on a phone; the tooltip shows the full name.
const CATEGORY_AXIS_WIDTH = 120;
const shortLabel = (name: string) => (name.length > 18 ? `${name.slice(0, 17)}…` : name);

const NAVY = "#0c2340";
const TEAL = "#2d8a9e";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const money = (v: number) => currency.format(v);
const moneyTick = (v: number) => compactCurrency.format(v);

export default function InsightsCharts({
  measure,
  byLob,
  byStatus,
  byYear,
  byCarrier,
  byCause,
  byLocation,
}: InsightsChartData) {
  const cards = insightsChartCards(measure);
  const isMoney = isMoneyMeasure(measure);
  const seriesName = isMoney ? INSIGHTS_MEASURE_LABELS[measure] : "Claims";
  const tick = isMoney ? moneyTick : undefined;
  const tooltip = isMoney ? (v: number) => money(v) : undefined;

  const byMeasure = <T extends MeasureTotals>(rows: T[]) =>
    [...rows].sort((a, b) => b[measure] - a[measure]);
  const lobRows = byMeasure(byLob);
  const carrierRows = byMeasure(byCarrier);
  const statusRows = byStatus.filter((row) => row[measure] > 0);

  // A carrier keeps its colour whichever measure is selected.
  const carrierNames = byCarrier.map((row) => row.carrier).sort((a, b) => a.localeCompare(b));
  const carrierColor = (carrier: string) => seriesColor(carrierNames.indexOf(carrier));

  const causeRows = topRows(byCause, measure, MAX_CAUSE_BARS, OTHER_CAUSES);
  const locationRows = topRows(byLocation, measure, MAX_LOCATION_BARS, OTHER_LOCATIONS);
  // Like carriers, a cause keeps its colour across measures; "Not given" and
  // "All other" are grey.
  const causeNames = byCause.map((row) => row.name).sort((a, b) => a.localeCompare(b));
  const causeColor = (name: string) =>
    name === NOT_GIVEN || name === OTHER_CAUSES
      ? NEUTRAL_SERIES_COLOR
      : seriesColor(causeNames.indexOf(name));

  return (
    <ChartGrid>
      <ChartCard title={cards.lob.title}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={lobRows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="lob"
              fontSize={12}
              interval={0}
              angle={-15}
              textAnchor="end"
              height={60}
            />
            <YAxis fontSize={12} tickFormatter={tick} />
            <Tooltip formatter={tooltip} />
            <Bar dataKey={measure} fill={NAVY} name={seriesName} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={cards.status.title}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <PieChart>
            <Pie
              data={statusRows}
              dataKey={measure}
              nameKey="name"
              outerRadius={100}
              label={isMoney ? ({ value }: { value: number }) => moneyTick(value) : true}
            >
              {statusRows.map((entry) => (
                <Cell key={entry.status} fill={STATUS_COLORS[entry.status].hex} />
              ))}
            </Pie>
            <Tooltip formatter={tooltip} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={cards.trend.title}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={byYear}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="year" fontSize={12} />
            <YAxis fontSize={12} tickFormatter={tick} />
            <Tooltip formatter={tooltip} />
            <Legend />
            <Line
              type="monotone"
              dataKey={measure}
              stroke={NAVY}
              strokeWidth={2}
              name={seriesName}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={cards.amountsByYear.title}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={byYear}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="year" fontSize={12} />
            <YAxis fontSize={12} tickFormatter={moneyTick} />
            <Tooltip formatter={(v: number) => money(v)} />
            <Legend />
            <Bar dataKey="paid" fill={TEAL} name={INSIGHTS_MEASURE_LABELS.paid} />
            <Bar dataKey="incurred" fill={NAVY} name={INSIGHTS_MEASURE_LABELS.incurred} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={cards.carrier.title} className="lg:col-span-2">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={carrierRows} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis type="number" fontSize={12} tickFormatter={tick} />
            <YAxis dataKey="carrier" type="category" fontSize={12} width={140} />
            <Tooltip formatter={tooltip} />
            <Bar dataKey={measure} name={seriesName}>
              {carrierRows.map((entry) => (
                <Cell key={entry.carrier} fill={carrierColor(entry.carrier)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={cards.cause.title}>
        <BreakdownBars
          rows={causeRows}
          measure={measure}
          seriesName={seriesName}
          tick={tick}
          tooltip={tooltip}
          colorOf={causeColor}
        />
      </ChartCard>

      <ChartCard title={cards.location.title}>
        <BreakdownBars
          rows={locationRows}
          measure={measure}
          seriesName={seriesName}
          tick={tick}
          tooltip={tooltip}
          colorOf={(name) =>
            name === NOT_GIVEN || name === OTHER_LOCATIONS ? NEUTRAL_SERIES_COLOR : TEAL
          }
        />
      </ChartCard>
    </ChartGrid>
  );
}

// Horizontal bars for the cause and location charts, which have long names.
function BreakdownBars({
  rows,
  measure,
  seriesName,
  tick,
  tooltip,
  colorOf,
}: {
  rows: BreakdownRow[];
  measure: InsightsMeasure;
  seriesName: string;
  tick: ((v: number) => string) | undefined;
  tooltip: ((v: number) => string) | undefined;
  colorOf: (name: string) => string;
}) {
  if (!rows.length) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height: CHART_HEIGHT }}
      >
        No claims to show.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis type="number" fontSize={12} tickFormatter={tick} allowDecimals={false} />
        <YAxis
          dataKey="name"
          type="category"
          fontSize={12}
          width={CATEGORY_AXIS_WIDTH}
          interval={0}
          tickFormatter={shortLabel}
        />
        <Tooltip formatter={tooltip} />
        <Bar dataKey={measure} name={seriesName}>
          {rows.map((row) => (
            <Cell key={row.name} fill={colorOf(row.name)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
