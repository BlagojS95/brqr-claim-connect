import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { fetchClaimDetail } from "@/lib/overview.functions";
import { uploadClaimDocument } from "@/lib/claim-documents";
import { StatusBadge } from "@/components/status-badge";
import { ClaimContactsTable } from "@/components/claim-contacts-table";
import { ClaimInternalNotes } from "@/components/claim-internal-notes";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileDown, Upload } from "lucide-react";

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
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const getClaim = useServerFn(fetchClaimDetail);
  const { data, isLoading } = useQuery({
    queryKey: ["claim", claimId],
    queryFn: async () => {
      const [claim, { data: docs }] = await Promise.all([
        getClaim({ data: { claimId } }),
        supabase
          .from("documents")
          .select("*")
          .eq("claim_id", claimId)
          .order("uploaded_at", { ascending: false }),
      ]);
      return { claim, docs: docs ?? [] };
    },
  });

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;
  const claim = data?.claim;
  if (!claim) return <div>Claim not found.</div>;

  // Admins and the claim's own client can both add documents; storage RLS
  // checks the client id at the front of the path.
  async function uploadFiles(files: File[]) {
    if (!claim || !files.length) return;
    setUploading(true);
    let uploaded = 0;
    for (const file of files) {
      try {
        await uploadClaimDocument(claim.client_id, claim.id, file);
        uploaded++;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Upload failed: ${file.name}`);
      }
    }
    setUploading(false);
    if (uploaded) toast.success(`Uploaded ${uploaded} document${uploaded === 1 ? "" : "s"}`);
    queryClient.invalidateQueries({ queryKey: ["claim", claimId] });
  }

  const timeline = [
    { label: "Date of Loss", date: claim.date_of_loss },
    { label: "Reported", date: claim.date_reported },
    { label: "Closed", date: claim.closed_date },
  ].filter((t) => t.date);

  return (
    <div className="space-y-6 max-w-7xl">
      <Link
        to="/claims"
        className="inline-flex items-center gap-1 text-sm text-navy hover:text-gold"
      >
        <ArrowLeft className="h-4 w-4" /> Back to claims
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-navy">{claim.claim_type} Claim</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            {claim.claim_number ?? "Claim number pending"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{claim.client_name}</p>
        </div>
        <StatusBadge status={claim.status} />
      </div>

      <section className="rounded-lg border border-border bg-card p-6 grid sm:grid-cols-2 md:grid-cols-3 gap-5">
        <Field label="Claimant Name" value={claim.claimant_name} />
        <Field label="Carrier" value={claim.carrier} />
        <Field label="Policy #" value={claim.policy_number} />
        <Field label="Line of Business" value={claim.line_of_business_description} />
        <Field
          label="Date of Loss"
          value={claim.date_of_loss ? new Date(claim.date_of_loss).toLocaleDateString() : null}
        />
        <Field label="Adjuster" value={claim.adjuster_name} />
        <Field
          label="Paid"
          value={
            claim.paid_amount != null ? `$${Number(claim.paid_amount).toLocaleString()}` : null
          }
        />
      </section>

      {claim.description && (
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="font-semibold text-navy mb-2">Description</h2>
          <p className="text-sm whitespace-pre-wrap text-foreground/90">{claim.description}</p>
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
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold text-navy">Documents</h2>
          <Button asChild variant="outline" size="sm" disabled={uploading}>
            <label className="cursor-pointer">
              <Upload className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Upload Document"}
              <input
                type="file"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  uploadFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
        </div>
        {data!.docs.length === 0 && (
          <p className="text-sm text-muted-foreground">No documents uploaded.</p>
        )}
        <ul className="space-y-2">
          {data!.docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between p-3 rounded-md border border-border"
            >
              <span className="text-sm">{d.file_name}</span>
              <a
                href={d.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-navy hover:text-gold inline-flex items-center gap-1 text-sm"
              >
                <FileDown className="h-4 w-4" /> Download
              </a>
            </li>
          ))}
        </ul>
      </section>

      {role === "agency_admin" && (
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="font-semibold text-navy mb-4">Internal Notes</h2>
          <ClaimInternalNotes claimId={claim.id} />
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="font-semibold text-navy mb-4">Contacts</h2>
        <ClaimContactsTable
          claimId={claim.id}
          email={{
            claimNumber: claim.claim_number,
            dateOfLoss: claim.date_of_loss,
            claimantName: claim.claimant_name,
          }}
        />
      </section>
    </div>
  );
}
