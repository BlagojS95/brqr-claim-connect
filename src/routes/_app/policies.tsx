import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { fetchAgencyOverview } from "@/lib/vertafore.functions";
import { Shield, Calendar, Building2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_app/policies")({
  component: PoliciesPage,
});

function PoliciesPage() {
  const [view, setView] = useState<"active" | "nonactive">("active");
  const [search, setSearch] = useState("");
  const getOverview = useServerFn(fetchAgencyOverview);
  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["policies"],
    queryFn: async () => (await getOverview({ data: { scope: "policies" } })).policies,
  });

  const term = search.trim().toLowerCase();
  const filtered = policies.filter((p) => {
    if (p.status !== (view === "active" ? "Active" : "Non Active")) return false;
    if (!term) return true;
    return (
      (p.policy_type?.toLowerCase() ?? "").includes(term) ||
      (p.policy_number?.toLowerCase() ?? "").includes(term) ||
      (p.carrier?.toLowerCase() ?? "").includes(term)
    );
  });

  const activeCount = policies.filter((p) => p.status === "Active").length;
  const nonActiveCount = policies.length - activeCount;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-navy">Policies</h1>
          <p className="text-sm text-muted-foreground mt-1">All policies on file ({policies.length}).</p>
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
              variant={view === "nonactive" ? "default" : "outline"}
              className={view === "nonactive" ? "bg-navy hover:bg-navy/90 text-navy-foreground" : ""}
              onClick={() => setView("nonactive")}
            >
              Non Active ({nonActiveCount})
            </Button>
          </div>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {view === "active" ? "No active policies on file." : "No non-active policies on file."}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => <PolicyCard key={p.id} p={p} />)}
      </div>
    </div>
  );
}

type PolicyRow = {
  id: string;
  policy_type: string | null;
  policy_number: string;
  carrier: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  status: "Active" | "Non Active";
};

function PolicyCard({ p }: { p: PolicyRow }) {
  const tone =
    p.status === "Active"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-slate-100 text-slate-600 border-slate-200";

  return (
    <div className={`rounded-lg border border-border bg-card p-5 space-y-3 ${p.status === "Non Active" ? "opacity-80" : ""}`}>
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
        <span className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded-full border ${tone}`}>
          {p.status}
        </span>
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" />
          <span>{p.carrier ?? "—"}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span>
            {p.effective_date ? new Date(p.effective_date).toLocaleDateString() : "—"}
            {" → "}
            {p.expiry_date ? new Date(p.expiry_date).toLocaleDateString() : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
