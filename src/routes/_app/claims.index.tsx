import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export const Route = createFileRoute("/_app/claims/")({
  component: ClaimsList,
});

function ClaimsList() {
  const [filter, setFilter] = useState<string>("All");
  const { data: claims = [], isLoading } = useQuery({
    queryKey: ["claims-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("claims")
        .select("*")
        .order("date_of_loss", { ascending: false, nullsFirst: false });
      return data ?? [];
    },
  });

  const filtered = filter === "All" ? claims : claims.filter((c) => c.status === filter);

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-navy">Claims</h1>
          <p className="text-sm text-muted-foreground mt-1">All reported claims.</p>
        </div>
        <div className="flex gap-2">
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
              <th className="text-left p-3">Last Follow Up</th>
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
                <td className="p-3">{c.claim_type}{c.is_notice_only && <span className="ml-2 text-xs text-gold">(Notice)</span>}</td>
                <td className="p-3">{c.carrier ?? "—"}</td>
                <td className="p-3"><StatusBadge status={c.status} /></td>
                <td className="p-3 font-mono text-xs">{c.claim_number ?? "—"}</td>
                <td className="p-3">{c.adjuster_name ?? "—"}</td>
                <td className="p-3 text-muted-foreground">{c.last_follow_up ? new Date(c.last_follow_up).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
