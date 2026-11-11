import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { forbidden, parseInput } from "@/lib/http-errors.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  enabledNotificationKinds,
  loadOutboxRows,
  outboxDeliveryDeps,
} from "@/lib/claim-notifications.server";
import {
  checkDuplicatesCore,
  deliverOutboxRow,
  deliverPendingRows,
  DuplicateCheckSchema,
  OUTBOX_STATUS,
  submitClaimCore,
  SubmitClaimSchema,
} from "@/lib/claim-submission";
import { DUPLICATE_CANDIDATE_COLUMNS } from "@/lib/duplicate-claims";
import { getClientMembership } from "@/lib/client-access.server";
import { isCompanyWide } from "@/lib/client-users";
import { todayIso } from "@/lib/dates";
import { loadDevVars } from "@/lib/load-dev-vars.server";

type CallerContext = { supabase: SupabaseClient<Database>; userId: string };

// The caller may report for clientId: an agency admin, or one of that
// client's users (fix 32). A location user only for their own locations.
function submitterDeps({ supabase, userId }: CallerContext) {
  return {
    async assertCanSubmitFor(clientId: string) {
      const { data: adminRole } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "agency_admin")
        .maybeSingle();
      if (adminRole) return;
      const member = await getClientMembership(userId);
      if (!member || member.clientId !== clientId) {
        forbidden("You can only report claims for your own account");
      }
      return isCompanyWide(member.role) ? undefined : { only: member.locationIds };
    },
    async getLocation(id: string, clientId: string) {
      const { data: location } = await supabaseAdmin
        .from("client_locations")
        .select("id")
        .eq("id", id)
        .eq("client_id", clientId)
        .maybeSingle();
      return location;
    },
    async findClaimsOnDate(clientId: string, dateOfLoss: string) {
      // Caller's token, so RLS limits a client to their own claims.
      const { data: rows, error } = await supabase
        .from("claims")
        .select(DUPLICATE_CANDIDATE_COLUMNS)
        .eq("client_id", clientId)
        .eq("date_of_loss", dateOfLoss);
      if (error) throw new Error(`Couldn't check for duplicate claims: ${error.message}`);
      return rows ?? [];
    },
  };
}

// Possible duplicates of a report (fix 38), checked before any file is
// uploaded or anything is saved.
export const checkDuplicateClaims = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(DuplicateCheckSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    return { duplicates: await checkDuplicatesCore(data, submitterDeps(context)) };
  });

// Saves a reported claim, its document rows and its notification outbox rows.
// Notifications are sent afterwards by processClaimNotifications, so a mail or
// webhook outage never loses the claim. Returns possible duplicates instead of
// saving unless skipDuplicateCheck is set.
export const submitClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(SubmitClaimSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    const { supabase, userId } = context;

    return submitClaimCore(data, {
      ...submitterDeps(context),
      today: () => todayIso(),
      async getLine(id) {
        const { data: line } = await supabase
          .from("lines_of_business")
          .select("id, name, code")
          .eq("id", id)
          .maybeSingle();
        return line;
      },
      async getCauseOfLoss(id) {
        const { data: cause } = await supabase
          .from("causes_of_loss")
          .select("id, active")
          .eq("id", id)
          .maybeSingle();
        return cause;
      },
      async getPolicy(id, clientId) {
        const { data: policy } = await supabase
          .from("policies")
          .select(
            "id, policy_number, carrier, effective_date, expiration_date, line_of_business_id",
          )
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
      notificationKinds: enabledNotificationKinds,
      async deleteClaim(id) {
        await supabaseAdmin.from("claims").delete().eq("id", id);
      },
    });
  });

// Sends the pending email/webhook for one claim, retrying with backoff.
// The claim form calls this after submitClaim returns, without waiting on it.
export const processClaimNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(z.object({ claimId: z.string().uuid() })))
  .handler(async ({ data, context }) => {
    await loadDevVars();
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
  .inputValidator(parseInput(z.object({ outboxId: z.string().uuid() })))
  .handler(async ({ data }) => {
    await loadDevVars();
    const { data: row, error } = await supabaseAdmin
      .from("notification_outbox")
      .update({ status: OUTBOX_STATUS.pending, attempts: 0 })
      .eq("id", data.outboxId)
      .eq("status", OUTBOX_STATUS.failed)
      .select("id, claim_id, kind, status, attempts")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That notification isn't in a failed state");

    const status = await deliverOutboxRow(row, outboxDeliveryDeps);
    return { status };
  });
