import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Tables } from "@/integrations/supabase/types";
import { fetchAll } from "@/lib/fetch-all";
import type {
  AgencyClaim,
  AgencyClient,
  AgencyOverview,
  AgencyPolicy,
  OverviewScope,
} from "@/lib/overview.types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function computePolicyStatus(effectiveDate: string | null, expiryDate: string | null): "Active" | "Non Active" {
  if (!expiryDate) return "Active";
  const now = Date.now();
  const expiry = new Date(expiryDate).getTime();
  if (effectiveDate) {
    const effective = new Date(effectiveDate).getTime();
    if (now < effective) return "Non Active";
  }
  return now <= expiry ? "Active" : "Non Active";
}

function displayName(client: { name?: string | null; company_name?: string | null } | null | undefined): string {
  return client?.company_name || client?.name || "";
}

function toClaim(row: Tables<"claims">, clientName: string): AgencyClaim {
  return {
    id: row.id,
    claim_number: row.claim_number,
    claim_type: row.claim_type,
    // ?? null: rows read before the claimant_name migration has been applied
    claimant_name: row.claimant_name ?? null,
    line_of_business_description: row.line_of_business_description,
    status: row.status,
    carrier: row.carrier,
    date_of_loss: row.date_of_loss,
    closed_date: row.closed_date,
    date_reported: row.date_reported,
    paid_amount: row.paid_amount,
    adjuster_name: row.adjuster_name,
    policy_number: row.policy_number,
    description: row.description,
    client_id: row.client_id,
    client_name: clientName,
  };
}

// Every query here runs with the caller's own token, so RLS does the scoping:
// an agency_admin gets every client's rows, a client only gets their own.
async function getScopedOverview(supabase: SupabaseClient<Database>, scope: OverviewScope): Promise<AgencyOverview> {
  const [clientRows, policyRows, claimRows] = await Promise.all([
    fetchAll<Tables<"clients">>((from, to) =>
      supabase.from("clients").select("*").order("name").order("id").range(from, to),
    ),
    scope === "claims"
      ? Promise.resolve([])
      : fetchAll<Tables<"policies">>((from, to) =>
          supabase.from("policies").select("*").order("id").range(from, to),
        ),
    scope === "policies"
      ? Promise.resolve([])
      : fetchAll<Tables<"claims">>((from, to) =>
          supabase
            .from("claims")
            .select("*")
            .order("date_of_loss", { ascending: false, nullsFirst: false })
            .order("id")
            .range(from, to),
        ),
  ]);

  const clientNames = new Map(clientRows.map((c) => [c.id, displayName(c)]));
  const claimCounts = new Map<string, number>();
  for (const c of claimRows) {
    claimCounts.set(c.client_id, (claimCounts.get(c.client_id) ?? 0) + 1);
  }

  const clients: AgencyClient[] = clientRows.map((c) => ({
    id: c.id,
    name: c.name,
    company_name: c.company_name,
    email: c.email,
    phone: c.phone,
    ams360_id: c.ams360_id,
    user_id: c.user_id,
    claims_count: claimCounts.get(c.id) ?? 0,
  }));

  const policies: AgencyPolicy[] = policyRows.map((p) => ({
    id: p.id,
    client_id: p.client_id,
    client_name: clientNames.get(p.client_id) ?? "",
    policy_number: p.policy_number,
    carrier: p.carrier,
    policy_type: p.policy_type,
    effective_date: p.effective_date,
    expiry_date: p.expiration_date,
    premium: p.premium,
    status: computePolicyStatus(p.effective_date, p.expiration_date),
  }));

  const claims = claimRows.map((c) => toClaim(c, clientNames.get(c.client_id) ?? ""));

  return { clients, policies, claims };
}

const ScopeSchema = z.object({ scope: z.enum(["all", "claims", "policies"]).optional() });

export const fetchAgencyOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ScopeSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    return getScopedOverview(context.supabase, data.scope ?? "all");
  });

export const fetchClaimDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ claimId: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    if (!UUID_RE.test(data.claimId)) return null;

    const { data: claim } = await context.supabase
      .from("claims")
      .select("*, clients(name, company_name)")
      .eq("id", data.claimId)
      .maybeSingle();
    if (!claim) return null;

    const { clients: clientRow, ...row } = claim;
    return toClaim(row, displayName(clientRow));
  });
