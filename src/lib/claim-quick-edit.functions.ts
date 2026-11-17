// Quick edit for agency staff (fix 53). The role is checked here on the server
// (requireAgencyAdmin); reads and writes run with the caller's own token, so
// the admin RLS policies on claims and claim_activity apply as well, as in
// claim-reserve.functions.ts and claim-waiting-on.functions.ts. A status change
// is logged by the log_claim_status_change trigger; everything else that
// changed goes into one 'claim_update' activity entry.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { httpError, parseInput, unprocessable } from "@/lib/http-errors.server";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { loadDevVars } from "@/lib/load-dev-vars.server";
import { CLAIM_ACTIVITY_KIND } from "@/lib/claim-activity";
import {
  CLAIM_EDITABLE_SELECT,
  QuickEditSchema,
  claimUpdateActivityBody,
  carrierDataChanged,
  diffClaimValues,
  type ClaimEditableValues,
  type FieldChange,
} from "@/lib/claim-quick-edit";
import { isAgencyStaff, staffNames } from "@/lib/claim-quick-edit.server";

export interface ClaimQuickEditData {
  values: ClaimEditableValues;
  claimType: string;
  clientName: string | null;
  carrier: string | null;
}

export const fetchClaimQuickEdit = createServerFn({ method: "GET" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(z.object({ claimId: z.string().uuid() })))
  .handler(async ({ data, context }): Promise<ClaimQuickEditData> => {
    const { data: row, error } = await context.supabase
      .from("claims")
      .select(`${CLAIM_EDITABLE_SELECT}, claim_type, carrier, clients(name, company_name)`)
      .eq("id", data.claimId)
      .maybeSingle();
    if (error) throw new Error(`Couldn't load the claim: ${error.message}`);
    if (!row) httpError(404, "Claim not found");
    const { claim_type, carrier, clients, ...values } = row;
    return {
      values,
      claimType: claim_type,
      clientName: clients?.company_name || clients?.name || null,
      carrier,
    };
  });

export const updateClaimQuickEdit = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(QuickEditSchema))
  .handler(async ({ data, context }): Promise<{ changes: FieldChange[] }> => {
    await loadDevVars();
    const { claimId, ...next } = data;

    const { data: current, error: readError } = await context.supabase
      .from("claims")
      .select(CLAIM_EDITABLE_SELECT)
      .eq("id", claimId)
      .maybeSingle();
    if (readError) throw new Error(`Couldn't load the claim: ${readError.message}`);
    if (!current) httpError(404, "Claim not found");

    if (
      next.assigned_to &&
      next.assigned_to !== current.assigned_to &&
      !(await isAgencyStaff(next.assigned_to))
    ) {
      unprocessable("Claims can only be assigned to agency staff");
    }

    const now = new Date().toISOString();
    const names = await staffNames([current.assigned_to, next.assigned_to]);
    const { update, changes } = diffClaimValues(current, next, {
      now: new Date(now),
      staffName: (id) => (id ? (names.get(id) ?? "Former staff member") : "Unassigned"),
    });
    if (!changes.length) return { changes };

    const { data: updated, error } = await context.supabase
      .from("claims")
      .update(carrierDataChanged(changes) ? { ...update, carrier_updated_at: now } : update)
      .eq("id", claimId)
      .select("id");
    if (error) throw new Error(`Couldn't save the claim: ${error.message}`);
    if (!updated?.length) httpError(404, "Claim not found");

    const body = claimUpdateActivityBody(changes);
    if (body) {
      const { error: logError } = await context.supabase.from("claim_activity").insert({
        claim_id: claimId,
        actor_id: context.userId,
        kind: CLAIM_ACTIVITY_KIND.claim_update,
        body,
      });
      if (logError) throw new Error(`Saved, but couldn't log the change: ${logError.message}`);
    }
    return { changes };
  });
