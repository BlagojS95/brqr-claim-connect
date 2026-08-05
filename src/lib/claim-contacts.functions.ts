import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAgencyOverview, getCustomerOverview } from "@/integrations/vertafore/aggregate.server";

const ROW_KEYS = ["broker_claims_contact", "adjuster", "attorney", "other_1", "other_2"] as const;

const InputSchema = z.object({ claimId: z.string() });

// Most claims are sourced live from Vertafore/AMS360 and never get a row in
// public.claims (claim_id there is Vertafore's own ClaimId — see
// aggregate.server.ts), so claim_contacts can't rely on a claims-table FK or
// join to figure out who owns a claim. This mirrors the same ownership check
// fetchClaimDetail already does, then seeds/reads the 5 fixed contact rows
// with the service-role client (RLS is still enforced for every other read
// or write the browser makes directly against these tables).
export const ensureClaimContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "agency_admin")
      .maybeSingle();

    let clientId: string | null = null;

    if (adminRole) {
      // Admin can see any claim. Try to resolve which portal client (if any)
      // owns it, so RLS also lets that client see/edit it once they log in.
      const overview = await getAgencyOverview("claims");
      const claim = overview.claims.find((c) => c.id === data.claimId);
      if (claim) {
        const { data: clientRow } = await supabase
          .from("clients")
          .select("id")
          .eq("ams360_id", claim.client_id)
          .maybeSingle();
        clientId = clientRow?.id ?? null;
      }
    } else {
      const { data: clientRow } = await supabase
        .from("clients")
        .select("id, ams360_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!clientRow) throw new Error("No client account found for this user");

      let owns = false;
      if (clientRow.ams360_id) {
        const overview = await getCustomerOverview(clientRow.ams360_id, "claims");
        owns = overview.claims.some((c) => c.id === data.claimId);
      }
      if (!owns) {
        const { data: localClaim } = await supabase
          .from("claims")
          .select("id")
          .eq("id", data.claimId)
          .eq("client_id", clientRow.id)
          .maybeSingle();
        owns = !!localClaim;
      }
      if (!owns) throw new Error("Claim not found");

      clientId = clientRow.id;
    }

    await supabaseAdmin.from("claim_contacts").upsert(
      ROW_KEYS.map((row_key) => ({ claim_id: data.claimId, row_key, client_id: clientId })),
      { onConflict: "claim_id,row_key", ignoreDuplicates: true },
    );

    const { data: contacts, error } = await supabaseAdmin
      .from("claim_contacts")
      .select("*, claim_contact_emails(*)")
      .eq("claim_id", data.claimId);
    if (error) throw error;

    return ROW_KEYS.map((key) => contacts?.find((r) => r.row_key === key)).filter(
      (r): r is NonNullable<typeof r> => !!r,
    );
  });
