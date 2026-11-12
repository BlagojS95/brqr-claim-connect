import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Building2, Calendar, DollarSign, MapPin, Shield } from "lucide-react";
import { incurredAmount, paidAmount, reserveAmount } from "@/lib/claim-metrics";
import { formatDate } from "@/lib/dates";
import { fetchPolicyDetail } from "@/lib/overview.functions";
import { POLICY_STATUS } from "@/lib/policy-status";
import { queryKeys } from "@/lib/query-keys";
import type { AgencyClaim } from "@/lib/overview.types";
import { StatusBadge } from "@/components/status-badge";

// One policy and every claim against it (fix 42). The totals come from the
// server (fetchPolicyDetail); this page only shows them.
export const Route = createFileRoute("/_app/policies/$policyId")({
  head: () => ({ meta: [{ title: "Policy | ClaimsQR" }] }),
  component: PolicyDetailPage,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

function PolicyDetailPage() {
  const { policyId } = Route.useParams();
  const getPolicy = useServerFn(fetchPolicyDetail);
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.policy(policyId),
    queryFn: () => getPolicy({ data: { policyId } }),
  });

  const back = (
    <Link
      to="/policies"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-navy"
    >
      <ArrowLeft className="h-4 w-4" /> Back to policies
    </Link>
  );

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!data) {
    return (
      <div className="space-y-4">
        {back}
        <p>Policy not found.</p>
      </div>
    );
  }

  const { policy, claims, totals } = data;
  const active = policy.status === POLICY_STATUS.active;

  return (
    <div className="space-y-6">
      {back}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-navy/5 flex items-center justify-center">
            <Shield className="h-5 w-5 text-navy" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-navy">
              {policy.policy_type ?? "Policy"}
            </h1>
            <div className="text-sm text-muted-foreground font-mono">{policy.policy_number}</div>
          </div>
        </div>
        <span
          className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded-full border ${
            active
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-slate-100 text-slate-600 border-slate-200"
          }`}
        >
          {policy.status}
        </span>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <Info label="Client" value={policy.client_name || "—"} />
        <Info
          label="Carrier"
          value={
            <span className="inline-flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              {policy.carrier ?? "—"}
            </span>
          }
        />
        <Info
          label="Term"
          value={
            <span className="inline-flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              {formatDate(policy.effective_date)} → {formatDate(policy.expiry_date)}
            </span>
          }
        />
        <Info
          label="Premium"
          value={
            <span className="inline-flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              {policy.premium == null ? "—" : fmt(Number(policy.premium))}
            </span>
          }
        />
        {policy.location_name && (
          <Info
            label="Location"
            value={
              <span className="inline-flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                {policy.location_name}
              </span>
            }
          />
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Stat label="Claims" value={String(totals.claims)} />
        <Stat label="Open" value={String(totals.open)} />
        <Stat label="Paid" value={fmt(totals.paid)} />
        <Stat label="Reserve" value={fmt(totals.reserve)} />
        <Stat label="Incurred" value={fmt(totals.incurred)} sub="Paid + reserve" />
      </div>

      <section className="rounded-lg border border-border bg-card overflow-hidden">
        <h2 className="px-5 py-3 border-b border-border text-sm font-semibold text-navy">
          Claims against this policy
        </h2>
        {claims.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">No claims against this policy.</p>
        ) : (
          <>
            <ClaimsTable claims={claims} totals={totals} />
            <ClaimCards claims={claims} />
          </>
        )}
      </section>
    </div>
  );
}

function ClaimNumber({ claim }: { claim: AgencyClaim }) {
  return claim.claim_number ? (
    <span className="font-mono text-xs">{claim.claim_number}</span>
  ) : (
    <span className="text-xs text-muted-foreground">Number pending</span>
  );
}

function ClaimsTable({
  claims,
  totals,
}: {
  claims: AgencyClaim[];
  totals: { claims: number; paid: number; reserve: number; incurred: number };
}) {
  return (
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left p-3">Date of loss</th>
            <th className="text-left p-3">Claim #</th>
            <th className="text-left p-3">Type</th>
            <th className="text-left p-3">Status</th>
            <th className="text-right p-3">Paid</th>
            <th className="text-right p-3">Reserve</th>
            <th className="text-right p-3">Incurred</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.id} className="border-t border-border hover:bg-muted/30">
              <td className="p-3 whitespace-nowrap">
                <Link
                  to="/claims/$claimId"
                  params={{ claimId: c.id }}
                  className="text-navy font-medium hover:underline"
                >
                  {formatDate(c.date_of_loss)}
                </Link>
              </td>
              <td className="p-3 whitespace-nowrap">
                <ClaimNumber claim={c} />
              </td>
              <td className="p-3">{c.claim_type}</td>
              <td className="p-3">
                <StatusBadge status={c.status} />
              </td>
              <td className="p-3 text-right whitespace-nowrap">{fmt(paidAmount(c))}</td>
              <td className="p-3 text-right whitespace-nowrap">{fmt(reserveAmount(c))}</td>
              <td className="p-3 text-right whitespace-nowrap">{fmt(incurredAmount(c))}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border bg-muted/20 font-semibold text-navy">
            <td className="p-3" colSpan={4}>
              Total ({totals.claims})
            </td>
            <td className="p-3 text-right whitespace-nowrap">{fmt(totals.paid)}</td>
            <td className="p-3 text-right whitespace-nowrap">{fmt(totals.reserve)}</td>
            <td className="p-3 text-right whitespace-nowrap">{fmt(totals.incurred)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Phones get one card per claim instead of a wide table.
function ClaimCards({ claims }: { claims: AgencyClaim[] }) {
  return (
    <ul className="md:hidden divide-y divide-border">
      {claims.map((c) => (
        <li key={c.id}>
          <Link
            to="/claims/$claimId"
            params={{ claimId: c.id }}
            className="block p-4 space-y-2 active:bg-muted/40"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-navy">{formatDate(c.date_of_loss)}</span>
              <StatusBadge status={c.status} />
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>{c.claim_type}</span>
              <ClaimNumber claim={c} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Amount label="Paid" value={paidAmount(c)} />
              <Amount label="Reserve" value={reserveAmount(c)} />
              <Amount label="Incurred" value={incurredAmount(c)} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Amount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{fmt(value)}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-xl md:text-2xl font-bold text-navy mt-1">{value}</div>
      {sub && <div className="text-xs mt-1 text-muted-foreground">{sub}</div>}
    </div>
  );
}
