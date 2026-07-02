import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  getAgencyOverview,
  getCustomerOverview,
  type AgencyOverview,
} from "@/integrations/vertafore/aggregate.server";

async function getScopedOverview(context: {
  userId: string;
  supabase: ReturnType<typeof createClient<Database>>;
}): Promise<AgencyOverview> {
  const { data: adminRole } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "agency_admin")
    .maybeSingle();

  if (adminRole) {
    return getAgencyOverview();
  }

  const { data: clientRow } = await context.supabase
    .from("clients")
    .select("ams360_id")
    .eq("user_id", context.userId)
    .maybeSingle();

  if (!clientRow?.ams360_id) {
    return { clients: [], policies: [], claims: [] };
  }

  return getCustomerOverview(clientRow.ams360_id);
}

export const fetchAgencyOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return getScopedOverview(context);
  });

export const fetchClaimDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ claimId: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const overview = await getScopedOverview(context);
    return overview.claims.find((c) => c.id === data.claimId) ?? null;
  });
