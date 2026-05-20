import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/status-badge";
import { ArrowLeft, FileDown } from "lucide-react";

export const Route = createFileRoute("/_app/claims/$claimId")({
  component: ClaimDetail,
});

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{value ?? "—"}</div>
    </div>
  );
}

function ClaimDetail() {
  const { claimId } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["claim", claimId],
    queryFn: async () => {
      const [{ data: claim }, { data: docs }] = await Promise.all([
        supabase.from("claims").select("*, policies(policy_number, carrier)").eq("id", claimId).maybeSingle(),
        supabase.from("documents").select("*").eq("claim_id", claimId).order("uploaded_at", { ascending: false }),
      ]);
      return { claim, docs: docs ?? [] };
    },
  });

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;
  const claim = data?.claim;
  if (!claim) return <div>Claim not found.</div>;
  const policy = claim.policies as { policy_number?: string; carrier?: string } | null;

  const timeline = [
    { label: "Date of Loss", date: claim.date_of_loss },
    { label: "Reported", date: claim.date_reported },
    { label: "FNOL Sent", date: claim.fnol_sent_date },
    { label: "Last Follow-Up", date: claim.last_follow_up },
  ].filter((t) => t.date);

  return (
    <div className="space-y-6 max-w-5xl">
      <Link to="/claims" className="inline-flex items-center gap-1 text-sm text-navy hover:text-gold">
        <ArrowLeft className="h-4 w-4" /> Back to claims
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-navy">
            {claim.claim_type} Claim {claim.is_notice_only && <span className="text-base text-gold font-medium">· Notice of Claim</span>}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            {claim.claim_number ?? "Claim number pending"}
          </p>
        </div>
        <StatusBadge status={claim.status} />
      </div>

      <section className="rounded-lg border border-border bg-card p-6 grid sm:grid-cols-2 md:grid-cols-3 gap-5">
        <Field label="Carrier" value={claim.carrier ?? policy?.carrier} />
        <Field label="Policy #" value={policy?.policy_number} />
        <Field label="Date of Loss" value={claim.date_of_loss ? new Date(claim.date_of_loss).toLocaleDateString() : null} />
        <Field label="Adjuster" value={claim.adjuster_name} />
        <Field label="Adjuster Email" value={claim.adjuster_email} />
        <Field label="Adjuster Phone" value={claim.adjuster_phone} />
        <Field label="Reserve" value={claim.reserve_amount != null ? `$${Number(claim.reserve_amount).toLocaleString()}` : null} />
        <Field label="Paid" value={claim.paid_amount != null ? `$${Number(claim.paid_amount).toLocaleString()}` : null} />
        <Field label="Carrier Email" value={claim.carrier_email} />
      </section>

      {claim.description && (
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="font-semibold text-navy mb-2">Description</h2>
          <p className="text-sm whitespace-pre-wrap text-foreground/90">{claim.description}</p>
        </section>
      )}

      {claim.notes && (
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="font-semibold text-navy mb-2">Notes</h2>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{claim.notes}</p>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="font-semibold text-navy mb-4">Timeline</h2>
        <ol className="space-y-3">
          {timeline.map((t) => (
            <li key={t.label} className="flex items-center gap-3 text-sm">
              <span className="h-2 w-2 rounded-full bg-gold" />
              <span className="font-medium w-36">{t.label}</span>
              <span className="text-muted-foreground">{new Date(t.date!).toLocaleString()}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="font-semibold text-navy mb-4">Documents</h2>
        {data!.docs.length === 0 && <p className="text-sm text-muted-foreground">No documents uploaded.</p>}
        <ul className="space-y-2">
          {data!.docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between p-3 rounded-md border border-border">
              <span className="text-sm">{d.file_name}</span>
              <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="text-navy hover:text-gold inline-flex items-center gap-1 text-sm">
                <FileDown className="h-4 w-4" /> Download
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
