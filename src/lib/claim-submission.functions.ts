import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadOutboxRows, outboxDeliveryDeps } from "@/lib/claim-notifications.server";
import {
  deliverOutboxRow,
  deliverPendingRows,
  submitClaimCore,
  SubmitClaimSchema,
} from "@/lib/claim-submission";
import { todayIso } from "@/lib/dates";
import { loadDevVars } from "@/lib/load-dev-vars.server";

await loadDevVars();

// Saves a reported claim, its document rows and its notification outbox rows.
// Notifications are sent afterwards by processClaimNotifications, so a mail or
// webhook outage never loses the claim.
export const submitClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SubmitClaimSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    return submitClaimCore(data, {
      today: () => todayIso(),
      async assertCanSubmitFor(clientId) {
        const { data: adminRole } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "agency_admin")
          .maybeSingle();
        if (adminRole) return;
        const { data: own } = await supabaseAdmin
          .from("clients")
          .select("id")
          .eq("id", clientId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!own) throw new Error("You can only report claims for your own account");
      },
      async getLine(id) {
        const { data: line } = await supabase
          .from("lines_of_business")
          .select("id, name, code")
          .eq("id", id)
          .maybeSingle();
        return line;
      },
      async getPolicy(id, clientId) {
        const { data: policy } = await supabase
          .from("policies")
          .select("id, policy_number, carrier, effective_date, expiration_date, line_of_business_id")
          .eq("id", id)
          .eq("client_id", clientId)
          .maybeSingle();
        return policy;
      },
      async signDocumentUrl(path) {
        const { data: signed } = await supabase.storage
          .from("claim-documents")
          .createSignedUrl(path, 60 * 60 * 24 * 365);
        return signed?.signedUrl ?? path;
      },
      async insertClaim(row) {
        // Caller's token, so RLS double-checks the client_id.
        const { data: claim, error } = await supabase
          .from("claims")
          .insert({ ...row, created_by: userId })
          .select("id")
          .single();
        if (error) throw new Error(`Couldn't save the claim: ${error.message}`);
        return claim;
      },
      async insertDocuments(rows) {
        const { error } = await supabase.from("documents").insert(rows);
        if (error) throw new Error(`Couldn't attach documents: ${error.message}`);
      },
      async insertOutbox(rows) {
        // Clients can't write the outbox; the service role does it after the checks above.
        const { error } = await supabaseAdmin.from("notification_outbox").insert(rows);
        if (error) throw new Error(`Couldn't queue notifications: ${error.message}`);
      },
      async deleteClaim(id) {
        await supabaseAdmin.from("claims").delete().eq("id", id);
      },
    });
  });

// Sends the pending email/webhook for one claim, retrying with backoff.
// The claim form calls this after submitClaim returns, without waiting on it.
export const processClaimNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ claimId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // RLS decides whether the caller may see this claim at all.
    const { data: claim } = await context.supabase
      .from("claims")
      .select("id")
      .eq("id", data.claimId)
      .maybeSingle();
    if (!claim) throw new Error("Claim not found");

    const rows = await loadOutboxRows(claim.id);
    return { results: await deliverPendingRows(rows, outboxDeliveryDeps) };
  });

// Admin "Retry" on a failed notification: back to pending, then send again.
export const retryClaimNotification = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator((input) => z.object({ outboxId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("notification_outbox")
      .update({ status: "pending", attempts: 0 })
      .eq("id", data.outboxId)
      .eq("status", "failed")
      .select("id, claim_id, kind, status, attempts")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That notification isn't in a failed state");

    const status = await deliverOutboxRow(row, outboxDeliveryDeps);
    return { status };
  });
