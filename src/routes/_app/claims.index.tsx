import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { fetchAgencyOverview } from "@/lib/vertafore.functions";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export const Route = createFileRoute("/_app/claims/")({
  component: ClaimsList,
});

function ClaimsList() {
  const [filter, setFilter] = useState<string>("All");
  const [search, setSearch] = useState("");
  const getOverview = useServerFn(fetchAgencyOverview);
  const { data: claims = [], isLoading } = useQuery({
    queryKey: ["claims-list"],
    queryFn: async () => (await getOverview({ data: { scope: "claims" } })).claims,
  });

  const q = search.trim().toLowerCase();
  const filtered = claims.filter((c) => {
    if (filter !== "All" && c.status !== filter) return false;
    if (!q) return true;
    return [
      c.claim_number,
      c.claim_type,
      c.carrier,
      c.adjuster_name,
      c.description,
      c.status,
    ]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-navy">Claims</h1>
          <p className="text-sm text-muted-foreground mt-1">All reported claims.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {["All", "Open", "Pending", "Closed"].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={filter === s ? "default" : "outline"}
              className={filter === s ? "bg-navy hover:bg-navy/90 text-navy-foreground" : ""}
              onClick={() => setFilter(s)}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by claim #, type, carrier, adjuster…"
          className="pl-9"
        />
      </div>

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left p-3">Date of Loss</th>
              <th className="text-left p-3">Type</th>
              <th className="text-left p-3">Carrier</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Claim #</th>
              <th className="text-left p-3">Adjuster</th>
              <th className="text-left p-3">Closed</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No claims found.</td></tr>
            )}
            {filtered.map((c) => (
              <tr key={c.id} className="border-t border-border hover:bg-muted/30 cursor-pointer">
                <td className="p-3">
                  <Link to="/claims/$claimId" params={{ claimId: c.id }} className="block">
                    {c.date_of_loss ? new Date(c.date_of_loss).toLocaleDateString() : "—"}
                  </Link>
                </td>
                <td className="p-3">{c.claim_type}</td>
                <td className="p-3">{c.carrier ?? "—"}</td>
                <td className="p-3"><StatusBadge status={c.status} /></td>
                <td className="p-3 font-mono text-xs">{c.claim_number ?? "—"}</td>
                <td className="p-3">{c.adjuster_name ?? "—"}</td>
                <td className="p-3 text-muted-foreground">{c.closed_date ? new Date(c.closed_date).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
