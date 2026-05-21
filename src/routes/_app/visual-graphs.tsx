import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LineChart as LineIcon } from "lucide-react";
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

export const Route = createFileRoute("/_app/visual-graphs")({
  component: VisualGraphsPage,
});

type Claim = {
  id: string;
  claim_type: string;
  status: string;
  carrier: string | null;
  date_of_loss: string | null;
  reserve_amount: number | null;
  paid_amount: number | null;
};

const COLORS = ["#0c2340", "#c9a84c", "#2d8a9e", "#c44569", "#5a8a5c", "#8b6f5e", "#4f46e5", "#e85d3a"];

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function VisualGraphsPage() {
  const { data: claims = [], isLoading } = useQuery({
    queryKey: ["visual-graphs-claims"],
    queryFn: async () => {
      const { data } = await supabase
        .from("claims")
        .select("id, claim_type, status, carrier, date_of_loss, reserve_amount, paid_amount");
      return (data ?? []) as Claim[];
    },
  });

  const byLob = useMemo(() => {
    const m = new Map<string, { lob: string; count: number; reserve: number; paid: number }>();
    for (const c of claims) {
      const k = c.claim_type || "Other";
      const r = m.get(k) ?? { lob: k, count: 0, reserve: 0, paid: 0 };
      r.count += 1;
      r.reserve += Number(c.reserve_amount ?? 0);
      r.paid += Number(c.paid_amount ?? 0);
      m.set(k, r);
    }
    return Array.from(m.values());
  }, [claims]);

  const byStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of claims) {
      const k = (c.status || "unknown").replace(/_/g, " ");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [claims]);

  const byYear = useMemo(() => {
    const m = new Map<number, { year: number; count: number; paid: number; reserve: number }>();
    for (const c of claims) {
      if (!c.date_of_loss) continue;
      const y = new Date(c.date_of_loss).getUTCFullYear();
      const r = m.get(y) ?? { year: y, count: 0, paid: 0, reserve: 0 };
      r.count += 1;
      r.paid += Number(c.paid_amount ?? 0);
      r.reserve += Number(c.reserve_amount ?? 0);
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
    const reserve = claims.reduce((s, c) => s + Number(c.reserve_amount ?? 0), 0);
    const paid = claims.reduce((s, c) => s + Number(c.paid_amount ?? 0), 0);
    const open = claims.filter((c) => c.status?.toLowerCase() !== "closed").length;
    const avgCost = claims.length ? (reserve + paid) / claims.length : 0;
    return { reserve, paid, open, total: claims.length, avgCost };
  }, [claims]);

  const avgCostYoY = useMemo(() => {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const lastYear = currentYear - 1;
    const costFor = (year: number) => {
      const yearClaims = claims.filter(
        (c) => c.date_of_loss && new Date(c.date_of_loss).getUTCFullYear() === year,
      );
      if (!yearClaims.length) return null;
      const total = yearClaims.reduce(
        (s, c) => s + Number(c.reserve_amount ?? 0) + Number(c.paid_amount ?? 0),
        0,
      );
      return total / yearClaims.length;
    };
    const current = costFor(currentYear);
    const previous = costFor(lastYear);
    if (current === null || previous === null || previous === 0) return null;
    return { pct: ((current - previous) / previous) * 100, currentYear, lastYear };
  }, [claims]);

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-navy flex items-center gap-2">
          <LineIcon className="h-6 w-6 text-gold" /> Visual Graphs
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visual breakdown of claims directly from your data.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Stat label="Total Claims" value={String(totals.total)} />
        <Stat label="Open Claims" value={String(totals.open)} />
        <Stat label="Total Reserve" value={fmt(totals.reserve)} />
        <Stat label="Total Paid" value={fmt(totals.paid)} />
        <Stat
          label="Avg Cost / Claim"
          value={fmt(totals.avgCost)}
          sub={
            avgCostYoY
              ? `${avgCostYoY.pct >= 0 ? "▲" : "▼"} ${Math.abs(avgCostYoY.pct).toFixed(1)}% vs ${avgCostYoY.lastYear}`
              : "No prior-year data"
          }
          subTone={avgCostYoY ? (avgCostYoY.pct >= 0 ? "up" : "down") : "neutral"}
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Claims by Line of Business">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byLob}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="lob" fontSize={12} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Bar dataKey="count" fill="#0c2340" name="Claims" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Claims by Status">
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={byStatus} dataKey="value" nameKey="name" outerRadius={100} label>
                {byStatus.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Reserve vs Paid by LOB">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byLob}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="lob" fontSize={12} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis fontSize={12} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              <Bar dataKey="reserve" fill="#c9a84c" name="Reserve" />
              <Bar dataKey="paid" fill="#2d8a9e" name="Paid" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Claims Trend by Year">
          <ResponsiveContainer width="100%" height={300}>
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

        <ChartCard title="Paid & Reserve by Year" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byYear}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="year" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              <Bar dataKey="paid" fill="#2d8a9e" name="Paid" />
              <Bar dataKey="reserve" fill="#c9a84c" name="Reserve" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Claims by Carrier" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byCarrier} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" fontSize={12} />
              <YAxis dataKey="carrier" type="category" fontSize={12} width={140} />
              <Tooltip />
              <Bar dataKey="count" fill="#4f46e5" name="Claims" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
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

function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-border bg-card p-5 ${className ?? ""}`}>
      <h2 className="text-sm font-semibold text-navy mb-4">{title}</h2>
      {children}
    </div>
  );
}
