// The only module that imports recharts. The Insights page loads it with
// React.lazy, so the charting library stays out of every other chunk.
//
// Every chart (fix 45): clicking a bar, point or slice opens /claims filtered
// to it and to the page's period; the page's measure and "Compare to prior
// year" apply to all of them; breakdown cards have a selector; and each card
// can show its numbers as a table.

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BREAKDOWN_DIMENSIONS,
  BREAKDOWN_LABELS,
  NOT_GIVEN,
  breakdownBy,
  topCompareRows,
  trendSeries,
  withPrior,
  type BreakdownClaim,
  type BreakdownDimension,
  type ClaimLinkFilter,
  type CompareRow,
  type TrendPoint,
} from "@/lib/insights-breakdowns";
import { INSIGHTS_CARDS, chartCardTitle, type ChartCardSpec } from "@/lib/insights-cards";
import {
  INSIGHTS_MEASURE_LABELS,
  isMoneyMeasure,
  measureNoun,
  type InsightsMeasure,
} from "@/lib/insights-measure";
import type { DateRange, TimeBucket } from "@/lib/insights-period";
import type { ClaimStatus } from "@/lib/claim-status";
import { NEUTRAL_SERIES_COLOR, STATUS_COLORS, seriesColor } from "@/lib/status-colors";
import { CHART_HEIGHT, ChartCard, ChartGrid, type ChartTable } from "./chart-card";

export type InsightsClaim = BreakdownClaim & { date_of_loss: string | null };

export interface InsightsChartsProps {
  measure: InsightsMeasure;
  /** The claims in the page's period. */
  claims: readonly InsightsClaim[];
  /** The same period a year earlier, when "Compare to prior year" is on. */
  priorClaims: readonly InsightsClaim[] | null;
  /** The page's period; null is all time. */
  range: DateRange | null;
  buckets: readonly TimeBucket[];
  /** Opens /claims with the filter, limited to the date range. */
  onOpen: (filter: ClaimLinkFilter, range: DateRange | null) => void;
}

const NAVY = "#0c2340";
const TEAL = "#2d8a9e";
const PRIOR = "#a3acb9";
const PRIOR_LABEL = "Prior year";

const OTHER = "All other";
const MAX_BARS = 10;
const MAX_BARS_WIDE = 12;

// Long names would squeeze the bars on a phone; the tooltip shows the full name.
const CATEGORY_AXIS_WIDTH = 120;
const shortLabel = (name: string) => (name.length > 18 ? `${name.slice(0, 17)}…` : name);

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

function formatters(measure: InsightsMeasure) {
  const isMoney = isMoneyMeasure(measure);
  return {
    isMoney,
    value: (v: number) => (isMoney ? money(v) : String(v)),
    tick: isMoney ? moneyTick : undefined,
    tooltip: isMoney ? (v: number) => money(v) : undefined,
    series: isMoney ? INSIGHTS_MEASURE_LABELS[measure] : "Claims",
    axis: isMoney ? `${INSIGHTS_MEASURE_LABELS[measure]} ($)` : "Number of claims",
  };
}

// recharts hands click handlers the clicked datum on `payload`, or for a
// chart-level click the active one on `activePayload`.
function clickedRow<T>(event: unknown): T | null {
  const e = event as { payload?: T; activePayload?: { payload?: T }[] } | null;
  return e?.payload ?? e?.activePayload?.[0]?.payload ?? null;
}

export default function InsightsCharts(props: InsightsChartsProps) {
  return (
    <ChartGrid>
      {INSIGHTS_CARDS.map((card) => {
        switch (card.kind) {
          case "breakdown":
            return <BreakdownCard key={card.id} card={card} {...props} />;
          case "status":
            return <StatusCard key={card.id} card={card} {...props} />;
          case "trend":
            return <TrendCard key={card.id} card={card} {...props} />;
          case "amounts":
            return <AmountsCard key={card.id} card={card} {...props} />;
        }
      })}
    </ChartGrid>
  );
}

type CardProps = InsightsChartsProps & { card: ChartCardSpec };

function compareTable(
  rows: CompareRow[],
  measure: InsightsMeasure,
  firstColumn: string,
  compare: boolean,
): ChartTable {
  const f = formatters(measure);
  return {
    columns: [firstColumn, f.series, ...(compare ? [PRIOR_LABEL] : [])],
    rows: rows.map((r) => ({
      key: r.name,
      cells: [r.name, f.value(r[measure]), ...(compare ? [f.value(r.prior[measure])] : [])],
    })),
  };
}

function Empty() {
  return (
    <div
      className="flex items-center justify-center text-sm text-muted-foreground"
      style={{ height: CHART_HEIGHT }}
    >
      No claims to show.
    </div>
  );
}

function BreakdownCard({ card, measure, claims, priorClaims, range, onOpen }: CardProps) {
  const [dimension, setDimension] = useState<BreakdownDimension>(card.dimension ?? "line");
  const compare = priorClaims !== null;
  const rows = useMemo(
    () =>
      topCompareRows(
        withPrior(
          breakdownBy(claims, dimension),
          priorClaims ? breakdownBy(priorClaims, dimension) : [],
        ),
        measure,
        card.wide ? MAX_BARS_WIDE : MAX_BARS,
        OTHER,
        dimension === "status",
      ),
    [claims, priorClaims, dimension, measure, card.wide],
  );
  // A name keeps its colour whichever measure or period is shown.
  const names = useMemo(
    () =>
      breakdownBy(claims, dimension)
        .map((r) => r.name)
        .sort((a, b) => a.localeCompare(b)),
    [claims, dimension],
  );
  const colorOf = (row: CompareRow) =>
    !row.filter || row.name === NOT_GIVEN
      ? NEUTRAL_SERIES_COLOR
      : dimension === "status"
        ? STATUS_COLORS[row.filter.status as ClaimStatus].hex
        : seriesColor(Math.max(0, names.indexOf(row.name)));

  const label = BREAKDOWN_LABELS[dimension];
  return (
    <ChartCard
      title={chartCardTitle(card, measure, dimension)}
      description={`Bar chart of ${measureNoun(measure).toLowerCase()} by ${label.toLowerCase()}. Select a bar to open those claims.`}
      className={card.wide ? "lg:col-span-2" : ""}
      table={compareTable(rows, measure, label, compare)}
      actions={
        <select
          aria-label={`Breakdown for this chart`}
          value={dimension}
          onChange={(e) => setDimension(e.target.value as BreakdownDimension)}
          className="h-9 rounded-md border border-input bg-background px-2 text-base md:text-xs"
        >
          {BREAKDOWN_DIMENSIONS.map((d) => (
            <option key={d} value={d}>
              By {BREAKDOWN_LABELS[d].toLowerCase()}
            </option>
          ))}
        </select>
      }
    >
      <CompareBars
        rows={rows}
        measure={measure}
        compare={compare}
        categoryLabel={label}
        colorOf={colorOf}
        onSelect={(row) => row.filter && onOpen(row.filter, range)}
      />
    </ChartCard>
  );
}

// Horizontal bars (names are long), with the prior year beside each when comparing.
function CompareBars({
  rows,
  measure,
  compare,
  categoryLabel,
  colorOf,
  onSelect,
}: {
  rows: CompareRow[];
  measure: InsightsMeasure;
  compare: boolean;
  categoryLabel: string;
  colorOf: (row: CompareRow) => string;
  onSelect: (row: CompareRow) => void;
}) {
  if (!rows.length) return <Empty />;
  const f = formatters(measure);
  const select = (event: unknown) => {
    const row = clickedRow<CompareRow>(event);
    if (row) onSelect(row);
  };
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={rows} layout="vertical" margin={{ top: 20, left: 0, right: 8, bottom: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          type="number"
          fontSize={12}
          tickFormatter={f.tick}
          allowDecimals={false}
          label={{ value: f.axis, position: "insideBottom", offset: -10, fontSize: 11 }}
        />
        <YAxis
          dataKey="name"
          type="category"
          fontSize={12}
          width={CATEGORY_AXIS_WIDTH}
          interval={0}
          tickFormatter={shortLabel}
          label={{ value: categoryLabel, position: "top", offset: 8, fontSize: 11 }}
        />
        <Tooltip formatter={f.tooltip} />
        {compare && <Legend verticalAlign="top" height={24} />}
        <Bar dataKey={measure} name={f.series} cursor="pointer" onClick={select}>
          {rows.map((row) => (
            <Cell key={row.name} fill={colorOf(row)} />
          ))}
        </Bar>
        {compare && (
          <Bar
            dataKey={(row: CompareRow) => row.prior[measure]}
            name={PRIOR_LABEL}
            fill={PRIOR}
            cursor="pointer"
            onClick={select}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

function StatusCard({ card, measure, claims, priorClaims, range, onOpen }: CardProps) {
  const compare = priorClaims !== null;
  const rows = useMemo(
    () =>
      topCompareRows(
        withPrior(
          breakdownBy(claims, "status"),
          priorClaims ? breakdownBy(priorClaims, "status") : [],
        ),
        measure,
        99,
        OTHER,
        true,
      ),
    [claims, priorClaims, measure],
  );
  const f = formatters(measure);
  const colorOf = (row: CompareRow) =>
    row.filter?.status ? STATUS_COLORS[row.filter.status].hex : NEUTRAL_SERIES_COLOR;
  const open = (row: CompareRow | null) => row?.filter && onOpen(row.filter, range);

  return (
    <ChartCard
      title={chartCardTitle(card, measure)}
      description={`${compare ? "Bar" : "Pie"} chart of ${measureNoun(measure).toLowerCase()} by status. Select a ${compare ? "bar" : "slice"} to open those claims.`}
      table={compareTable(rows, measure, "Status", compare)}
    >
      {!rows.length ? (
        <Empty />
      ) : compare ? (
        // Two pies can't be compared at a glance; bars side by side can.
        <CompareBars
          rows={rows}
          measure={measure}
          compare
          categoryLabel="Status"
          colorOf={colorOf}
          onSelect={open}
        />
      ) : (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <PieChart>
            <Pie
              data={rows.filter((r) => r[measure] > 0)}
              dataKey={measure}
              nameKey="name"
              outerRadius={100}
              cursor="pointer"
              onClick={(event: unknown) => open(clickedRow<CompareRow>(event))}
              label={f.isMoney ? ({ value }: { value: number }) => moneyTick(value) : true}
            >
              {rows.map((row) => (
                <Cell key={row.name} fill={colorOf(row)} />
              ))}
            </Pie>
            <Tooltip formatter={f.tooltip} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

function trendTable(
  points: TrendPoint[],
  columns: [string, (p: TrendPoint) => string][],
): ChartTable {
  return {
    columns: ["Period", ...columns.map(([c]) => c)],
    rows: points.map((p) => ({
      key: p.key,
      cells: [p.label, ...columns.map(([, cell]) => cell(p))],
    })),
  };
}

const timeAxisLabel = (points: TrendPoint[]) =>
  points[0]?.key.length === 4 ? "Year of loss" : "Month of loss";

function TrendCard({ card, measure, claims, priorClaims, buckets, onOpen }: CardProps) {
  const compare = priorClaims !== null;
  const points = useMemo(
    () => trendSeries(claims, buckets, priorClaims),
    [claims, buckets, priorClaims],
  );
  const f = formatters(measure);
  const open = (event: unknown) => {
    const point = clickedRow<TrendPoint>(event);
    if (point) onOpen({}, point.range);
  };
  return (
    <ChartCard
      title={chartCardTitle(card, measure)}
      description={`Line chart of ${measureNoun(measure).toLowerCase()} by date of loss. Select a point to open that period's claims.`}
      table={trendTable(points, [
        [f.series, (p) => f.value(p[measure])],
        ...(compare
          ? [
              [PRIOR_LABEL, (p: TrendPoint) => f.value(p.prior[measure])] as [
                string,
                (p: TrendPoint) => string,
              ],
            ]
          : []),
      ])}
    >
      {!points.length ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart
            data={points}
            onClick={open}
            margin={{ top: 8, right: 8, bottom: 16, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="label"
              fontSize={12}
              label={{
                value: timeAxisLabel(points),
                position: "insideBottom",
                offset: -10,
                fontSize: 11,
              }}
            />
            <YAxis
              fontSize={12}
              tickFormatter={f.tick}
              allowDecimals={false}
              label={{ value: f.axis, angle: -90, position: "insideLeft", fontSize: 11, dy: 50 }}
            />
            <Tooltip formatter={f.tooltip} />
            <Legend verticalAlign="top" height={24} />
            <Line
              type="monotone"
              dataKey={measure}
              stroke={NAVY}
              strokeWidth={2}
              name={f.series}
              cursor="pointer"
              activeDot={{ r: 6, cursor: "pointer" }}
            />
            {compare && (
              <Line
                type="monotone"
                dataKey={(p: TrendPoint) => p.prior[measure]}
                stroke={PRIOR}
                strokeWidth={2}
                strokeDasharray="5 4"
                name={PRIOR_LABEL}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

function AmountsCard({ card, measure, claims, priorClaims, buckets, onOpen }: CardProps) {
  const compare = priorClaims !== null;
  const points = useMemo(
    () => trendSeries(claims, buckets, priorClaims),
    [claims, buckets, priorClaims],
  );
  const open = (event: unknown) => {
    const point = clickedRow<TrendPoint>(event);
    if (point) onOpen({}, point.range);
  };
  const paidLabel = INSIGHTS_MEASURE_LABELS.paid;
  const incurredLabel = INSIGHTS_MEASURE_LABELS.incurred;
  const priorIncurred = `${PRIOR_LABEL} incurred`;
  return (
    <ChartCard
      title={chartCardTitle(card, measure)}
      description="Bar chart of paid and incurred by date of loss. Select a bar to open that period's claims."
      table={trendTable(points, [
        [paidLabel, (p) => money(p.paid)],
        [incurredLabel, (p) => money(p.incurred)],
        ...(compare
          ? [
              [priorIncurred, (p: TrendPoint) => money(p.prior.incurred)] as [
                string,
                (p: TrendPoint) => string,
              ],
            ]
          : []),
      ])}
    >
      {!points.length ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={points} onClick={open} margin={{ top: 8, right: 8, bottom: 16, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="label"
              fontSize={12}
              label={{
                value: timeAxisLabel(points),
                position: "insideBottom",
                offset: -10,
                fontSize: 11,
              }}
            />
            <YAxis
              fontSize={12}
              tickFormatter={moneyTick}
              label={{
                value: "Amount ($)",
                angle: -90,
                position: "insideLeft",
                fontSize: 11,
                dy: 30,
              }}
            />
            <Tooltip formatter={(v: number) => money(v)} />
            <Legend verticalAlign="top" height={24} />
            <Bar dataKey="paid" fill={TEAL} name={paidLabel} cursor="pointer" />
            <Bar dataKey="incurred" fill={NAVY} name={incurredLabel} cursor="pointer" />
            {compare && (
              <Bar
                dataKey={(p: TrendPoint) => p.prior.incurred}
                fill={PRIOR}
                name={priorIncurred}
                cursor="pointer"
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
