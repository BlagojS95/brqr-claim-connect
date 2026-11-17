import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { ClaimLocationControl } from "@/components/claim/claim-location-control";
import { ClaimReportFlags } from "@/components/claim/claim-report-flags";
import { WC_CLAIM_KIND_LABELS } from "@/lib/executive-report";
import { isCompanyWide } from "@/lib/client-users";
import {
  incurredAmount,
  netIncurred,
  paidAmount,
  recoveryAmount,
  reserveAmount,
} from "@/lib/claim-metrics";
import { formatDate, formatTime } from "@/lib/dates";
import { fetchClaimDetail } from "@/lib/overview.functions";
import { queryKeys } from "@/lib/query-keys";
import { deleteClaimDocument, uploadClaimDocument } from "@/lib/claim-documents";
import { StatusBadge } from "@/components/status-badge";
import { TermLabel } from "@/components/glossary-tip";
import type { GlossaryTerm } from "@/lib/glossary";
import { ClaimQuickEditButton } from "@/components/staff/claim-quick-edit";
import { ClaimActivityLog } from "@/components/claim-activity-log";
import { ClaimMessages } from "@/components/claim/claim-messages";
import { WatchButton } from "@/components/claim/watch-button";
import { ClaimContactsTable } from "@/components/claim-contacts-table";
import { EmailCarrierButton } from "@/components/staff/email-carrier-dialog";
import { ClaimInternalNotes } from "@/components/claim-internal-notes";
import { ClaimRecoveryEditor, ClaimReserveEditor } from "@/components/claim-reserve-editor";
import { ClaimOutcome } from "@/components/claim/claim-outcome";
import { WaitingOnControl } from "@/components/claim/waiting-on-control";
import { ClaimResponseTimes } from "@/components/staff/claim-response-times";
import { ClaimDocumentRequests, RequestedFromYouCard } from "@/components/claim/document-requests";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states/error-state";
import { LoadingSkeleton } from "@/components/states/loading-skeleton";
import { useUndoableRemoval } from "@/hooks/use-undoable-removal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, FileDown, FileText, Trash2, Upload } from "lucide-react";
import { EmptyState } from "@/components/states/empty-state";
import { formatDateTime } from "@/lib/claim-quick-edit";

export const Route = createFileRoute("/_app/claims/$claimId")({
  head: () => ({ meta: [{ title: "Claim | ClaimsQR" }] }),
  component: ClaimDetail,
});

function Field({
  label,
  value,
  term,
}: {
  label: string;
  value: React.ReactNode;
  /** Adds the plain-English "?" help (fix 49). */
  term?: GlossaryTerm;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {term ? <TermLabel term={term}>{label}</TermLabel> : label}
      </div>
      <div className="mt-1 text-sm">{value ?? "—"}</div>
    </div>
  );
}

function RemoveDocumentButton({
  fileName,
  onConfirm,
}: {
  fileName: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground hover:text-destructive inline-flex items-center gap-1 text-sm"
        >
          <Trash2 className="h-4 w-4" aria-hidden /> Remove
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this document?</AlertDialogTitle>
          <AlertDialogDescription>
            "{fileName}" will be removed from this claim for everyone. You can undo this for a few
            seconds afterwards.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ClaimDetail() {
  const { claimId } = Route.useParams();
  const { role, clientRole } = useAuth();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const getClaim = useServerFn(fetchClaimDetail);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.claim(claimId),
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

  // Removing a document hides it at once and deletes it after the 8 s undo window.
  const documentRemoval = useUndoableRemoval<{ id: string; file_name: string; file_url: string }>({
    message: (doc) => `Removed ${doc.file_name}`,
    commit: deleteClaimDocument,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.claim(claimId) }),
  });

  if (isLoading) return <LoadingSkeleton variant="detail" label="Loading claim" />;
  if (isError)
    return <ErrorState title="We couldn't load this claim" error={error} onRetry={refetch} />;
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
    queryClient.invalidateQueries({ queryKey: queryKeys.claim(claimId) });
  }

  const visibleDocs = data!.docs.filter((d) => !documentRemoval.hiddenIds.has(d.id));

  // Loss details from the claim form; imported claims usually have none.
  const loss = claim.loss_details;
  const lossFields = loss
    ? [
        { label: "Time of Loss", value: loss.time_of_loss && formatTime(loss.time_of_loss) },
        { label: "Loss Location", value: loss.loss_location },
        { label: "Injuries", value: loss.injuries == null ? null : loss.injuries ? "Yes" : "No" },
        { label: "Reported By", value: loss.reporter_name },
        { label: "Reporter Phone", value: loss.reporter_phone },
        { label: "Reporter Email", value: loss.reporter_email },
        { label: "Vehicles Involved", value: loss.vehicles_involved },
        { label: "Driver", value: loss.driver_name },
        { label: "Police Report #", value: loss.police_report_number },
        { label: "Employee", value: loss.employee_name },
        { label: "Job Title", value: loss.employee_job_title },
        { label: "Body Part", value: loss.injured_body_part },
        {
          label: "Reported to Employer",
          value: loss.date_reported_to_employer && formatDate(loss.date_reported_to_employer),
        },
        { label: "Third-Party Contact", value: loss.third_party_contact },
      ].filter((f) => f.value)
    : [];
  // Cause of loss (fix 35) is on imported claims too, so it doesn't need loss_details.
  if (claim.cause_of_loss) {
    lossFields.unshift({ label: "Cause of Loss", value: claim.cause_of_loss });
  }

  // Timeline step labels (display copy), not claim status values.
  const timeline = [
    { label: "Date of Loss", date: claim.date_of_loss },
    { label: "Reported", date: claim.date_reported },
    { label: "Closed", date: claim.closed_date },
  ].filter((t) => t.date);

  return (
    <div className="space-y-6">
      <Link
        to="/claims"
        className="inline-flex items-center gap-1 text-sm text-navy hover:text-gold-text"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to claims
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-navy">{claim.claim_type} Claim</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            {claim.claim_number ?? "Claim number pending"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{claim.client_name}</p>
        </div>
        <div className="flex items-center gap-2">
          <WatchButton claimId={claim.id} showLabel />
          {role === "agency_admin" && <ClaimQuickEditButton claimId={claim.id} />}
          <StatusBadge status={claim.status} />
        </div>
      </div>

      {role === "client" && <RequestedFromYouCard claimId={claim.id} clientId={claim.client_id} />}

      <ClaimOutcome claim={claim} />

      <section className="rounded-lg border border-border bg-card p-6 grid sm:grid-cols-2 md:grid-cols-3 gap-5">
        <Field label="Claimant Name" value={claim.claimant_name} />
        <Field label="Carrier" value={claim.carrier} />
        <Field label="Policy #" value={claim.policy_number} />
        <Field label="Line of Business" value={claim.line_of_business} />
        <Field label="Date of Loss" value={formatDate(claim.date_of_loss)} />
        <Field label="Adjuster" value={claim.adjuster_name} />
        <Field
          label="Last updated from carrier"
          value={claim.carrier_updated_at ? formatDateTime(claim.carrier_updated_at) : "Not yet"}
        />
        <Field label="Paid" term="paid" value={`$${paidAmount(claim).toLocaleString()}`} />
        <Field
          label="Reserve"
          term="reserve"
          value={
            role === "agency_admin" ? (
              <ClaimReserveEditor
                key={reserveAmount(claim)}
                claimId={claim.id}
                reserve={reserveAmount(claim)}
              />
            ) : (
              `$${reserveAmount(claim).toLocaleString()}`
            )
          }
        />
        <Field
          label="Incurred"
          term="incurred"
          value={`$${incurredAmount(claim).toLocaleString()}`}
        />
        {role === "agency_admin" ? (
          <Field
            label="Recoveries"
            term="recovery"
            value={
              <ClaimRecoveryEditor
                key={recoveryAmount(claim)}
                claimId={claim.id}
                recovery={recoveryAmount(claim)}
              />
            }
          />
        ) : (
          recoveryAmount(claim) > 0 && (
            <Field
              label="Recoveries"
              term="recovery"
              value={`$${recoveryAmount(claim).toLocaleString()}`}
            />
          )
        )}
        {recoveryAmount(claim) > 0 && (
          <Field
            label="Net Incurred"
            term="netIncurred"
            value={`$${netIncurred(claim).toLocaleString()}`}
          />
        )}
        <Field
          label="Waiting on"
          term="waitingOn"
          value={<WaitingOnControl claim={claim} editable={role === "agency_admin"} />}
        />
        {role === "agency_admin" && (
          <Field label="Response times" value={<ClaimResponseTimes claimId={claim.id} />} />
        )}
        {role === "agency_admin" ? (
          <Field label="For reports" value={<ClaimReportFlags claim={claim} />} />
        ) : (
          (claim.is_litigated || claim.wc_claim_kind) && (
            <Field
              label="Claim details"
              value={[
                claim.is_litigated ? "In litigation" : null,
                claim.wc_claim_kind ? WC_CLAIM_KIND_LABELS[claim.wc_claim_kind] : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          )
        )}
        <Field
          label="Location"
          value={
            <ClaimLocationControl
              claim={claim}
              editable={role === "agency_admin" || isCompanyWide(clientRole)}
            />
          }
        />
      </section>

      {claim.description && (
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="font-semibold text-navy mb-2">Description</h2>
          <p className="text-sm whitespace-pre-wrap text-foreground/90">{claim.description}</p>
        </section>
      )}

      {lossFields.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="font-semibold text-navy mb-4">Loss Details</h2>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-5">
            {lossFields.map((f) => (
              <Field key={f.label} label={f.label} value={f.value} />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="font-semibold text-navy mb-4">Timeline</h2>
        <ol className="space-y-3">
          {timeline.map((t) => (
            <li key={t.label} className="flex items-center gap-3 text-sm">
              <span className="h-2 w-2 rounded-full bg-gold" />
              <span className="font-medium w-36">{t.label}</span>
              <span className="text-muted-foreground">{formatDate(t.date)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold text-navy">Documents</h2>
          <Button asChild variant="outline" size="sm" disabled={uploading}>
            <label className="cursor-pointer">
              <Upload className="h-3.5 w-3.5" aria-hidden /> {uploading ? "Uploading…" : "Upload Document"}
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
        {visibleDocs.length === 0 && (
          <EmptyState
            compact
            icon={FileText}
            title="No documents yet"
            text="Use Upload Document above to add photos, reports or letters."
          />
        )}
        <ul className="space-y-2">
          {visibleDocs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between p-3 rounded-md border border-border"
            >
              <span className="text-sm">{d.file_name}</span>
              <div className="flex items-center gap-4">
                <a
                  href={d.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-navy hover:text-gold-text inline-flex items-center gap-1 text-sm"
                >
                  <FileDown className="h-4 w-4" aria-hidden /> Download
                </a>
                <RemoveDocumentButton
                  fileName={d.file_name}
                  onConfirm={() => documentRemoval.remove(d)}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <ClaimDocumentRequests claimId={claim.id} isAdmin={role === "agency_admin"} />

      {role === "agency_admin" && (
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="font-semibold text-navy mb-4">Internal Notes</h2>
          <ClaimInternalNotes claimId={claim.id} />
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h2 className="font-semibold text-navy">Contacts</h2>
          {role === "agency_admin" && <EmailCarrierButton claimId={claim.id} />}
        </div>
        <ClaimContactsTable
          claimId={claim.id}
          email={{
            claimNumber: claim.claim_number,
            dateOfLoss: claim.date_of_loss,
            claimantName: claim.claimant_name,
          }}
        />
      </section>

      <section id="messages" className="rounded-lg border border-border bg-card p-6">
        <h2 className="font-semibold text-navy mb-4">Messages</h2>
        <ClaimMessages claimId={claim.id} />
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="font-semibold text-navy mb-4">Activity</h2>
        <ClaimActivityLog claimId={claim.id} />
      </section>
    </div>
  );
}
