import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { fetchAgencyOverview } from "@/lib/vertafore.functions";
import { useAuth } from "@/hooks/use-auth";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { PlusCircle, Bell, FileText, DollarSign, ClipboardList, Calendar } from "lucide-react";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function Dashboard() {
  const { role, user } = useAuth();
  const isAdmin = role === "agency_admin";
  const getOverview = useServerFn(fetchAgencyOverview);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", user?.id, isAdmin],
    enabled: !!user,
    queryFn: async () => {
      const overview = await getOverview({ data: { scope: "all" } });
      return { claims: overview.claims.slice(0, 50), policies: overview.policies };
    },
  });

  const claims = data?.claims ?? [];
  const policies = data?.policies ?? [];
  const openClaims = claims.filter((c) => c.status === "Open").length;
  const totalPaid = claims.reduce((s, c) => s + Number(c.paid_amount ?? 0), 0);
  const lastLoss = claims[0]?.date_of_loss ?? null;

  const cards = [
    { label: "Open Claims", value: openClaims, icon: ClipboardList },
    { label: "Total Paid", value: fmtCurrency(totalPaid), icon: DollarSign },
    { label: "Active Policies", value: policies.length, icon: FileText },
    { label: "Last Claim", value: lastLoss ? new Date(lastLoss).toLocaleDateString() : "—", icon: Calendar },
  ];

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-navy">
            {isAdmin ? "Agency Dashboard" : "Welcome back"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin ? "All-client overview." : "Overview of your active claims and policies."}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/claims/new">
            <Button className="bg-navy hover:bg-navy/90 text-navy-foreground gap-2">
              <PlusCircle className="h-4 w-4" /> Report New Claim
            </Button>
          </Link>
          <Link to="/claims/notice">
            <Button variant="outline" className="border-gold text-navy gap-2">
              <Bell className="h-4 w-4" /> Notice of Claim
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{c.label}</span>
              <c.icon className="h-4 w-4 text-gold" />
            </div>
            <div className="mt-2 text-2xl font-bold text-navy">{c.value}</div>
          </div>
        ))}
      </div>

      <ClaimsSummary claims={claims} />

      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold text-navy">Recent Claims</h2>
          <Link to="/claims" className="text-sm text-navy hover:text-gold">View all →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Carrier</th>
                <th className="text-left p-3">Claim #</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && claims.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No claims yet.</td></tr>
              )}
              {claims.slice(0, 8).map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                  <td className="p-3">{c.date_of_loss ? new Date(c.date_of_loss).toLocaleDateString() : "—"}</td>
                  <td className="p-3">{c.claim_type}</td>
                  <td className="p-3"><StatusBadge status={c.status} /></td>
                  <td className="p-3">{c.carrier ?? "—"}</td>
                  <td className="p-3 font-mono text-xs">
                    <Link to="/claims/$claimId" params={{ claimId: c.id }} className="text-navy hover:text-gold">
                      {c.claim_number ?? "Pending"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}

interface ClaimRow {
  status: string;
  claim_type: string;
  paid_amount: number | string | null;
}

function ClaimsSummary({ claims }: { claims: ClaimRow[] }) {
  const total = claims.length;
  const byStatus = claims.reduce<Record<string, number>>((acc, c) => {
    if (c.status === "Under Review") return acc;
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});
  const byType = claims.reduce<Record<string, number>>((acc, c) => {
    acc[c.claim_type] = (acc[c.claim_type] ?? 0) + 1;
    return acc;
  }, {});
  const paid = claims.reduce((s, c) => s + Number(c.paid_amount ?? 0), 0);

  const statusTones: Record<string, string> = {
    Open: "bg-emerald-500",
    Pending: "bg-amber-500",
    Closed: "bg-slate-400",
    "Notice Only": "bg-blue-500",
  };

  const topTypes = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxType = Math.max(1, ...topTypes.map(([, n]) => n));

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="p-5 border-b border-border">
        <h2 className="font-semibold text-navy">Claims Summary</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Breakdown of all claims on file.</p>
      </div>
      <div className="p-5 grid gap-6 md:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">By Status</div>
          <div className="space-y-2">
            {Object.entries(byStatus).length === 0 && (
              <p className="text-sm text-muted-foreground">No claims yet.</p>
            )}
            {Object.entries(byStatus).map(([s, n]) => {
              const pct = total ? (n / total) * 100 : 0;
              return (
                <div key={s}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-navy">{s}</span>
                    <span className="text-muted-foreground">{n}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full ${statusTones[s] ?? "bg-navy"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">By Type</div>
          <div className="space-y-2">
            {topTypes.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
            {topTypes.map(([t, n]) => (
              <div key={t}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-navy">{t}</span>
                  <span className="text-muted-foreground">{n}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-gold" style={{ width: `${(n / maxType) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Financials</div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Paid</span>
              <span className="font-semibold text-navy">{fmtCurrency(paid)}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
