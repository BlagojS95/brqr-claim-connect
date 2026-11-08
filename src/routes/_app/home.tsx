import { createFileRoute, Link, linkOptions } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  STATUS_BUCKETS,
  countByStatus,
  openCount,
  totalIncurred,
  totalPaid,
} from "@/lib/claim-metrics";
import { CLAIM_STATUS, CLAIM_STATUS_LABELS, claimStatusLabel } from "@/lib/claim-status";
import { STATUS_COLORS } from "@/lib/status-colors";
import { formatDate } from "@/lib/dates";
import { POLICY_STATUS } from "@/lib/policy-status";
import { fetchAgencyOverview } from "@/lib/overview.functions";
import { overviewQueryOptions } from "@/lib/query-keys";
import type { AgencyClaim } from "@/lib/overview.types";
import { useAuth } from "@/hooks/use-auth";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { PlusCircle, Bell, FileText, DollarSign, ClipboardList, Calendar } from "lucide-react";

export const Route = createFileRoute("/_app/home")({
  head: () => ({ meta: [{ title: "Home | ClaimsQR" }] }),
  component: Home,
});

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function Home() {
  const { role, user } = useAuth();
  const isAdmin = role === "agency_admin";
  const getOverview = useServerFn(fetchAgencyOverview);

  const { data, isLoading } = useQuery({
    ...overviewQueryOptions("all", getOverview),
    enabled: !!user,
  });

  const claims = data?.claims ?? [];
  const policies = data?.policies ?? [];
  const openClaims = openCount(claims);
  const paidToDate = totalPaid(claims);
  const lastLoss = claims[0]?.date_of_loss ?? null;
  const activePolicies = policies.filter((p) => p.status === POLICY_STATUS.active).length;

  const lastClaim = claims[0] ?? null;

  // Each card links to the list behind its number. Last Claim has no link
  // when there is no claim.
  const cards = [
    {
      label: "Open Claims",
      value: openClaims,
      icon: ClipboardList,
      ariaLabel: `Open claims: ${openClaims}, view list`,
      link: linkOptions({ to: "/claims", search: { status: CLAIM_STATUS.open } }),
    },
    {
      label: "Total Paid",
      value: fmtCurrency(paidToDate),
      icon: DollarSign,
      ariaLabel: `Total paid: ${fmtCurrency(paidToDate)}, view in Insights`,
      link: linkOptions({ to: "/insights", search: { measure: "paid" } }),
    },
    {
      label: "Active Policies",
      value: activePolicies,
      icon: FileText,
      ariaLabel: `Active policies: ${activePolicies}, view policies`,
      link: linkOptions({ to: "/policies" }),
    },
    {
      label: "Last Claim",
      value: formatDate(lastLoss),
      icon: Calendar,
      ariaLabel: `Last claim: ${formatDate(lastLoss)}, view claim`,
      link: lastClaim
        ? linkOptions({ to: "/claims/$claimId", params: { claimId: lastClaim.id } })
        : null,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-navy">
            {isAdmin ? "Agency Home" : "Welcome back"}
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
              <Bell className="h-4 w-4" /> Incident Notice Only
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => {
          const body = (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {c.label}
                </span>
                <c.icon className="h-4 w-4 text-gold" />
              </div>
              <div className="mt-2 text-2xl font-bold text-navy">{c.value}</div>
            </>
          );
          return c.link ? (
            <Link
              key={c.label}
              {...c.link}
              aria-label={c.ariaLabel}
              className="block rounded-lg border border-border bg-card p-5 transition-colors hover:border-gold hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
            >
              {body}
            </Link>
          ) : (
            <div key={c.label} className="rounded-lg border border-border bg-card p-5">
              {body}
            </div>
          );
        })}
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
                // The claim # link is stretched over the whole row (after:inset-0
                // against the relative <tr>), so the row is one real link: click
                // anywhere, Tab + Enter, Ctrl/Cmd-click for a new tab.
                <tr
                  key={c.id}
                  className="group relative border-t border-border hover:bg-muted/30 focus-within:bg-muted/30"
                >
                  <td className="p-3">{formatDate(c.date_of_loss)}</td>
                  <td className="p-3">{c.claim_type}</td>
                  <td className="p-3"><StatusBadge status={c.status} /></td>
                  <td className="p-3">{c.carrier ?? "—"}</td>
                  <td className="p-3 font-mono text-xs">
                    <Link
                      to="/claims/$claimId"
                      params={{ claimId: c.id }}
                      aria-label={`Claim ${c.claim_number ?? "Pending"}: ${c.claim_type}, ${claimStatusLabel(c.status)}, loss date ${formatDate(c.date_of_loss)}`}
                      className="text-navy group-hover:text-gold focus-visible:outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-gold"
                    >
                      {/* Display copy for a missing claim number, not a claim status. */}
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

function ClaimsSummary({ claims }: { claims: AgencyClaim[] }) {
  const total = claims.length;
  const counts = countByStatus(claims);
  const byStatus = STATUS_BUCKETS.filter((s) => counts[s] > 0).map((s) => [s, counts[s]] as const);
  const byType = claims.reduce<Record<string, number>>((acc, c) => {
    acc[c.claim_type] = (acc[c.claim_type] ?? 0) + 1;
    return acc;
  }, {});
  const paid = totalPaid(claims);
  const incurred = totalIncurred(claims);

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
            {byStatus.length === 0 && (
              <p className="text-sm text-muted-foreground">No claims yet.</p>
            )}
            {byStatus.map(([s, n]) => {
              const pct = total ? (n / total) * 100 : 0;
              return (
                <div key={s}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-navy">{CLAIM_STATUS_LABELS[s]}</span>
                    <span className="text-muted-foreground">{n}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full ${STATUS_COLORS[s].bar}`}
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
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reserve</span>
              <span className="font-semibold text-navy">{fmtCurrency(incurred - paid)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Incurred</span>
              <span className="font-semibold text-navy">{fmtCurrency(incurred)}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
