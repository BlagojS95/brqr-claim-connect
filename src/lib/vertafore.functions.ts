import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  getAgencyOverview,
  getCustomerOverview,
  type AgencyOverview,
  type OverviewScope,
} from "@/integrations/vertafore/aggregate.server";

async function getScopedOverview(
  context: {
    userId: string;
    supabase: ReturnType<typeof createClient<Database>>;
  },
  scope: OverviewScope,
): Promise<AgencyOverview> {
  const { data: adminRole } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "agency_admin")
    .maybeSingle();

  if (adminRole) {
    return getAgencyOverview(scope);
  }

  const { data: clientRow } = await context.supabase
    .from("clients")
    .select("ams360_id")
    .eq("user_id", context.userId)
    .maybeSingle();

  if (!clientRow?.ams360_id) {
    return { clients: [], policies: [], claims: [] };
  }

  return getCustomerOverview(clientRow.ams360_id, scope);
}

const ScopeSchema = z.object({ scope: z.enum(["all", "claims", "policies"]).optional() });

export const fetchAgencyOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ScopeSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    return getScopedOverview(context, data.scope ?? "all");
  });

export const fetchClaimDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ claimId: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const overview = await getScopedOverview(context, "claims");
    const match = overview.claims.find((c) => c.id === data.claimId);
    if (match) return match;

    // Not every claim exists in AMS360 yet — one just submitted through the app
    // only lives in the local Supabase `claims` table until it's synced. RLS on
    // `claims` already restricts a client to their own rows / admins to all rows,
    // so this fallback can't leak another client's local claim.
    const { data: local } = await context.supabase
      .from("claims")
      .select("*, clients(name, company_name)")
      .eq("id", data.claimId)
      .maybeSingle();
    if (!local) return null;

    const clientRow = local.clients as { name?: string; company_name?: string } | null;
    return {
      id: local.id,
      claim_number: null,
      claim_type: local.claim_type,
      line_of_business_description: null,
      status: local.status,
      carrier: local.carrier,
      date_of_loss: local.date_of_loss,
      closed_date: local.closed_date,
      date_reported: local.date_reported,
      paid_amount: local.paid_amount,
      adjuster_name: local.adjuster_name,
      // `policy_number` isn't in the generated Database type yet.
      policy_number: (local as { policy_number?: string }).policy_number ?? null,
      description: local.description,
      client_id: local.client_id,
      client_name: clientRow?.company_name || clientRow?.name || "",
    };
  });
