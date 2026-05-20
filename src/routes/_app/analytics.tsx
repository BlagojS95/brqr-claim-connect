import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BarChart3, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_app/analytics")({
  component: AnalyticsPage,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Claim = {
  id: string;
  claim_number: string | null;
  claim_type: string;
  status: string;
  carrier: string | null;
  date_of_loss: string | null;
  reserve_amount: number | null;
  paid_amount: number | null;
};

function AnalyticsPage() {
  const [search, setSearch] = useState("");

  const { data: claims = [], isLoading } = useQuery({
    queryKey: ["analytics-claims"],
    queryFn: async () => {
      const { data } = await supabase
        .from("claims")
        .select("id, claim_number, claim_type, status, carrier, date_of_loss, reserve_amount, paid_amount")
        .order("date_of_loss", { ascending: false });
      return (data ?? []) as Claim[];
    },
  });

  const groups = useMemo(() => {
    const map = new Map<string, { year: number; lob: string; carrier: string; rows: Claim[] }>();
    for (const c of claims) {
      const year = c.date_of_loss ? new Date(c.date_of_loss).getUTCFullYear() : new Date().getUTCFullYear();
      const lob = c.claim_type || "Other";
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
        String(g.year).includes(term) ||
        g.lob.toLowerCase().includes(term) ||
        g.carrier.toLowerCase().includes(term)
    );
  }, [claims, search]);

  const valued = new Date().toLocaleDateString();

  return (
    <div className="space-y-6 max-w-7xl">
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
          const open = g.rows.filter((r) => r.status?.toLowerCase() !== "closed").length;
          const closed = totalClaims - open;
          const reserve = g.rows.reduce((s, r) => s + Number(r.reserve_amount ?? 0), 0);
          const paid = g.rows.reduce((s, r) => s + Number(r.paid_amount ?? 0), 0);
          return (
            <section key={`${g.year}-${g.lob}-${g.carrier}`} className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/30 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <div><span className="text-muted-foreground">LOB:</span> <span className="font-semibold text-navy">{g.lob}</span></div>
                <div><span className="text-muted-foreground">Year:</span> <span className="font-semibold text-navy">{g.year}</span></div>
                <div><span className="text-muted-foreground">Carrier:</span> <span className="font-semibold text-navy">{g.carrier}</span></div>
                <div className="ml-auto text-xs text-muted-foreground">Valued {valued}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left p-3">Claim #</th>
                      <th className="text-center p-3">Open</th>
                      <th className="text-center p-3">Closed</th>
                      <th className="text-right p-3">Reserve</th>
                      <th className="text-right p-3">Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => {
                      const isClosed = r.status?.toLowerCase() === "closed";
                      return (
                        <tr key={r.id} className="border-t border-border">
                          <td className="p-3 font-mono text-xs">{r.claim_number ?? "—"}</td>
                          <td className="p-3 text-center">{isClosed ? 0 : 1}</td>
                          <td className="p-3 text-center">{isClosed ? 1 : 0}</td>
                          <td className="p-3 text-right">{fmt(Number(r.reserve_amount ?? 0))}</td>
                          <td className="p-3 text-right">{fmt(Number(r.paid_amount ?? 0))}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-border bg-muted/20 font-semibold text-navy">
                      <td className="p-3">Total ({totalClaims})</td>
                      <td className="p-3 text-center">{open}</td>
                      <td className="p-3 text-center">{closed}</td>
                      <td className="p-3 text-right">{fmt(reserve)}</td>
                      <td className="p-3 text-right">{fmt(paid)}</td>
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
