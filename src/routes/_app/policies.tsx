import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Shield, Calendar, Building2, UserRound, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_app/policies")({
  component: PoliciesPage,
});

function PoliciesPage() {
  const [view, setView] = useState<"active" | "expired">("active");
  const [search, setSearch] = useState("");
  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["policies"],
    queryFn: async () => {
      const { data } = await supabase
        .from("policies")
        .select("*")
        .order("expiration_date", { ascending: false, nullsFirst: false });
      return data ?? [];
    },
  });

  const today = new Date();
  const status = (exp: string | null) => {
    if (!exp) return { label: "Active", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", expired: false };
    const d = new Date(exp);
    const days = Math.ceil((d.getTime() - today.getTime()) / 86400000);
    if (days < 0) return { label: "Expired", tone: "bg-red-50 text-red-700 border-red-200", expired: true };
    if (days <= 30) return { label: `Expires in ${days}d`, tone: "bg-amber-50 text-amber-800 border-amber-200", expired: false };
    return { label: "Active", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", expired: false };
  };

  const filtered = policies.filter((p) => {
    const s = status(p.expiration_date);
    const matchesView = view === "active" ? !s.expired : s.expired;
    const term = search.trim().toLowerCase();
    const matchesSearch = !term ||
      (p.policy_type?.toLowerCase() ?? "").includes(term) ||
      (p.policy_number?.toLowerCase() ?? "").includes(term) ||
      (p.carrier?.toLowerCase() ?? "").includes(term) ||
      (p.broker_name?.toLowerCase() ?? "").includes(term);
    return matchesView && matchesSearch;
  });

  const activeCount = policies.filter((p) => !status(p.expiration_date).expired).length;
  const expiredCount = policies.length - activeCount;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-navy">Policies</h1>
          <p className="text-sm text-muted-foreground mt-1">All active and expired insurance policies on file.</p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search policies…"
              className="pl-9 w-56"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={view === "active" ? "default" : "outline"}
              className={view === "active" ? "bg-navy hover:bg-navy/90 text-navy-foreground" : ""}
              onClick={() => setView("active")}
            >
              Active ({activeCount})
            </Button>
            <Button
              size="sm"
              variant={view === "expired" ? "default" : "outline"}
              className={view === "expired" ? "bg-navy hover:bg-navy/90 text-navy-foreground" : ""}
              onClick={() => setView("expired")}
            >
              History ({expiredCount})
            </Button>
          </div>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {view === "active" ? "No active policies on file." : "No expired policies yet."}
        </p>
      )}

      {view === "active" && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => <PolicyCard key={p.id} p={p} s={status(p.expiration_date)} />)}
        </div>
      )}

      {view === "expired" && (() => {
        const groups = new Map<string, typeof filtered>();
        for (const p of filtered) {
          const eff = p.effective_date ? new Date(p.effective_date).getUTCFullYear() : null;
          const exp = p.expiration_date ? new Date(p.expiration_date).getUTCFullYear() : null;
          const key = eff && exp ? `${eff}–${exp}` : exp ? `${exp}` : "Undated";
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(p);
        }
        const sorted = Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
        return (
          <div className="space-y-8">
            {sorted.map(([period, items]) => (
              <section key={period} className="space-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-navy">{period}</h2>
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">{items.length} {items.length === 1 ? "policy" : "policies"}</span>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {items.map((p) => <PolicyCard key={p.id} p={p} s={status(p.expiration_date)} />)}
                </div>
              </section>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

type PolicyRow = {
  id: string;
  policy_type: string | null;
  policy_number: string;
  carrier: string | null;
  broker_name: string | null;
  effective_date: string | null;
  expiration_date: string | null;
};

function PolicyCard({ p, s }: { p: PolicyRow; s: { label: string; tone: string; expired: boolean } }) {
  return (
    <div className={`rounded-lg border border-border bg-card p-5 space-y-3 ${s.expired ? "opacity-80" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-md bg-navy/5 flex items-center justify-center">
            <Shield className="h-4 w-4 text-navy" />
          </div>
          <div>
            <div className="font-semibold text-navy">{p.policy_type ?? "Policy"}</div>
            <div className="text-xs text-muted-foreground font-mono">{p.policy_number}</div>
          </div>
        </div>
        <span className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded-full border ${s.tone}`}>
          {s.label}
        </span>
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" />
          <span>{p.carrier ?? "—"}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" />
          <span>Broker: <span className="text-foreground">{p.broker_name ?? "Unassigned"}</span></span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span>
            {p.effective_date ? new Date(p.effective_date).toLocaleDateString() : "—"}
            {" → "}
            {p.expiration_date ? new Date(p.expiration_date).toLocaleDateString() : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
