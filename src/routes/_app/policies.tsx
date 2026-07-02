import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { fetchAgencyOverview } from "@/lib/vertafore.functions";
import { Shield, Building2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_app/policies")({
  component: PoliciesPage,
});

function PoliciesPage() {
  const [search, setSearch] = useState("");
  const getOverview = useServerFn(fetchAgencyOverview);
  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["policies"],
    queryFn: async () => (await getOverview()).policies,
  });

  const term = search.trim().toLowerCase();
  const filtered = policies.filter((p) => {
    if (!term) return true;
    return (
      (p.policy_type?.toLowerCase() ?? "").includes(term) ||
      (p.policy_number?.toLowerCase() ?? "").includes(term) ||
      (p.carrier?.toLowerCase() ?? "").includes(term)
    );
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-navy">Policies</h1>
          <p className="text-sm text-muted-foreground mt-1">All policies on file ({policies.length}).</p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search policies…"
            className="pl-9 w-56"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No policies on file.</p>
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
};

function PolicyCard({ p }: { p: PolicyRow }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-md bg-navy/5 flex items-center justify-center">
          <Shield className="h-4 w-4 text-navy" />
        </div>
        <div>
          <div className="font-semibold text-navy">{p.policy_type ?? "Policy"}</div>
          <div className="text-xs text-muted-foreground font-mono">{p.policy_number}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Building2 className="h-3.5 w-3.5" />
        <span>{p.carrier ?? "—"}</span>
      </div>
    </div>
  );
}
