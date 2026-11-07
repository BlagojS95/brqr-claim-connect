import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseInput } from "@/lib/http-errors.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadDevVars } from "@/lib/load-dev-vars.server";
import { CONTACT_ROW_KEYS, applyContactDefaults } from "@/lib/claim-contacts";

const InputSchema = z.object({ claimId: z.string().uuid() });

// The ownership check is the RLS-scoped read of the claim itself: an admin can
// read any claim, a client only their own. Once that passes, the fixed
// contact rows are seeded/read with the service-role client, since clients
// have no INSERT policy on claim_contacts (RLS is still enforced for every
// other read or write the browser makes directly against these tables).
export const ensureClaimContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(InputSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    const { data: claim } = await context.supabase
      .from("claims")
      .select("id, client_id, adjuster_name, adjuster_email, adjuster_phone")
      .eq("id", data.claimId)
      .maybeSingle();
    if (!claim) throw new Error("Claim not found");

    await supabaseAdmin.from("claim_contacts").upsert(
      CONTACT_ROW_KEYS.map((row_key) => ({
        claim_id: claim.id,
        row_key,
        client_id: claim.client_id,
      })),
      { onConflict: "claim_id,row_key", ignoreDuplicates: true },
    );

    const { data: contacts, error } = await supabaseAdmin
      .from("claim_contacts")
      .select("*, claim_contact_emails(*)")
      .eq("claim_id", claim.id);
    if (error) throw error;

    // Any signed-in user may read agency_settings. If the row or the table is
    // missing (migration not applied yet), the default inbox is used.
    const { data: settings } = await context.supabase
      .from("agency_settings")
      .select("broker_claims_email")
      .eq("id", 1)
      .maybeSingle();

    return applyContactDefaults(contacts ?? [], claim, settings?.broker_claims_email);
  });
