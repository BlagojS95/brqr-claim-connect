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
import { STATUS_COLORS, seriesColor } from "@/lib/status-colors";
import { CHART_HEIGHT, ChartCard, ChartGrid, INSIGHTS_CHART_CARDS as CARDS } from "./chart-card";

export interface InsightsChartData {
  byLob: { lob: string; count: number; paid: number }[];
  byStatus: { status: ClaimStatus; name: string; value: number }[];
  byYear: { year: number; count: number; paid: number }[];
  byCarrier: { carrier: string; count: number }[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

export default function InsightsCharts({ byLob, byStatus, byYear, byCarrier }: InsightsChartData) {
  return (
    <ChartGrid>
      <ChartCard title={CARDS.lob.title}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={byLob}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="lob"
              fontSize={12}
              interval={0}
              angle={-15}
              textAnchor="end"
              height={60}
            />
            <YAxis fontSize={12} />
            <Tooltip />
            <Bar dataKey="count" fill="#0c2340" name="Claims" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={CARDS.status.title}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <PieChart>
            <Pie data={byStatus} dataKey="value" nameKey="name" outerRadius={100} label>
              {byStatus.map((entry) => (
                <Cell key={entry.status} fill={STATUS_COLORS[entry.status].hex} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={CARDS.trend.title}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={byYear}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="year" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="count" stroke="#0c2340" strokeWidth={2} name="Claims" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={CARDS.paidByYear.title}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={byYear}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="year" fontSize={12} />
            <YAxis fontSize={12} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmt(v)} />
            <Legend />
            <Bar dataKey="paid" fill="#2d8a9e" name="Paid" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={CARDS.carrier.title} className="lg:col-span-2">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={byCarrier} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis type="number" fontSize={12} />
            <YAxis dataKey="carrier" type="category" fontSize={12} width={140} />
            <Tooltip />
            <Bar dataKey="count" name="Claims">
              {byCarrier.map((entry, i) => (
                <Cell key={entry.carrier} fill={seriesColor(i)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </ChartGrid>
  );
}
