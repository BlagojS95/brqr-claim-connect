import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadDevVars } from "@/lib/load-dev-vars.server";

await loadDevVars();

const ROW_KEYS = ["broker_claims_contact", "adjuster", "attorney", "other_1", "other_2"] as const;

const InputSchema = z.object({ claimId: z.string().uuid() });

// The ownership check is the RLS-scoped read of the claim itself: an admin can
// read any claim, a client only their own. Once that passes, the 5 fixed
// contact rows are seeded/read with the service-role client, since clients
// have no INSERT policy on claim_contacts (RLS is still enforced for every
// other read or write the browser makes directly against these tables).
export const ensureClaimContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: claim } = await context.supabase
      .from("claims")
      .select("id, client_id")
      .eq("id", data.claimId)
      .maybeSingle();
    if (!claim) throw new Error("Claim not found");

    await supabaseAdmin.from("claim_contacts").upsert(
      ROW_KEYS.map((row_key) => ({ claim_id: claim.id, row_key, client_id: claim.client_id })),
      { onConflict: "claim_id,row_key", ignoreDuplicates: true },
    );

    const { data: contacts, error } = await supabaseAdmin
      .from("claim_contacts")
      .select("*, claim_contact_emails(*)")
      .eq("claim_id", claim.id);
    if (error) throw error;

    return ROW_KEYS.map((key) => contacts?.find((r) => r.row_key === key)).filter(
      (r): r is NonNullable<typeof r> => !!r,
    );
  });
