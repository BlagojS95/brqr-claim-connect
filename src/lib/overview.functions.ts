import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseInput } from "@/lib/http-errors.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Tables } from "@/integrations/supabase/types";
import { fetchAll } from "@/lib/fetch-all";
import {
  CLAIM_SELECT,
  UUID_RE,
  displayName,
  toClaim,
  toPolicy,
  type ClaimRow,
  type PolicyRow,
} from "@/lib/overview.server";
import { isClaimOnPolicy, policyTotals, type PolicyTotals } from "@/lib/policy-claims";
import type {
  AgencyClaim,
  AgencyClient,
  AgencyLocation,
  AgencyOverview,
  AgencyPolicy,
  OverviewScope,
} from "@/lib/overview.types";

// Every query here runs with the caller's own token, so RLS does the scoping:
// an agency_admin gets every client's rows, a client only gets their own.
async function getScopedOverview(
  supabase: SupabaseClient<Database>,
  scope: OverviewScope,
): Promise<AgencyOverview> {
  const [clientRows, policyRows, claimRows, locationRows] = await Promise.all([
    fetchAll<Tables<"clients">>((from, to) =>
      supabase.from("clients").select("*").order("name").order("id").range(from, to),
    ),
    scope === "claims"
      ? Promise.resolve([])
      : fetchAll<PolicyRow>((from, to) =>
          supabase.from("policies").select("*, client_locations(name)").order("id").range(from, to),
        ),
    scope === "policies"
      ? Promise.resolve([])
      : fetchAll<ClaimRow>((from, to) =>
          supabase
            .from("claims")
            .select(CLAIM_SELECT)
            .order("date_of_loss", { ascending: false, nullsFirst: false })
            .order("id")
            .range(from, to),
        ),
    fetchAll<Tables<"client_locations">>((from, to) =>
      supabase.from("client_locations").select("*").order("name").order("id").range(from, to),
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

  const policies: AgencyPolicy[] = policyRows.map((p) =>
    toPolicy(p, clientNames.get(p.client_id) ?? ""),
  );

  const claims = claimRows.map((c) => toClaim(c, clientNames.get(c.client_id) ?? ""));

  const locations: AgencyLocation[] = locationRows.map((l) => ({
    id: l.id,
    client_id: l.client_id,
    name: l.name,
    address: l.address,
  }));

  return { clients, policies, claims, locations };
}

const ScopeSchema = z.object({ scope: z.enum(["all", "claims", "policies"]).optional() });

export const fetchAgencyOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => parseInput(ScopeSchema)(input ?? {}))
  .handler(async ({ data, context }) => {
    return getScopedOverview(context.supabase, data.scope ?? "all");
  });

export const fetchClaimDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(z.object({ claimId: z.string() })))
  .handler(async ({ data, context }) => {
    if (!UUID_RE.test(data.claimId)) return null;

    const { data: claim } = await context.supabase
      .from("claims")
      .select(`${CLAIM_SELECT}, clients(name, company_name)`)
      .eq("id", data.claimId)
      .maybeSingle();
    if (!claim) return null;

    const { clients: clientRow, ...row } = claim;
    return {
      ...toClaim(row, displayName(clientRow)),
      // ?? null: rows read before the claim_form_fields migration has been applied
      loss_details: {
        time_of_loss: row.time_of_loss ?? null,
        loss_location: row.loss_location ?? null,
        reporter_name: row.reporter_name ?? null,
        reporter_phone: row.reporter_phone ?? null,
        reporter_email: row.reporter_email ?? null,
        injuries: row.injuries ?? null,
        vehicles_involved: row.vehicles_involved ?? null,
        driver_name: row.driver_name ?? null,
        police_report_number: row.police_report_number ?? null,
        employee_name: row.employee_name ?? null,
        employee_job_title: row.employee_job_title ?? null,
        injured_body_part: row.injured_body_part ?? null,
        date_reported_to_employer: row.date_reported_to_employer ?? null,
        third_party_contact: row.third_party_contact ?? null,
      },
    };
  });

export interface PolicyDetail {
  policy: AgencyPolicy;
  /** The claims against the policy, newest loss first. */
  claims: AgencyClaim[];
  /** Computed here from those claims (fix 42), never in the browser. */
  totals: PolicyTotals;
}

// The policy detail page (fix 42). Caller's token: RLS decides whether the
// policy and which of its client's claims this user may see (a location user
// only gets their sites' claims), so a policy they can't see is "not found".
export const fetchPolicyDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(z.object({ policyId: z.string() })))
  .handler(async ({ data, context }): Promise<PolicyDetail | null> => {
    if (!UUID_RE.test(data.policyId)) return null;

    const { data: row } = await context.supabase
      .from("policies")
      .select("*, client_locations(name), clients(name, company_name)")
      .eq("id", data.policyId)
      .maybeSingle();
    if (!row) return null;
    const { clients: clientRow, ...policyRow } = row;
    const clientName = displayName(clientRow);
    const policy = toPolicy(policyRow, clientName);

    const claimRows = await fetchAll<ClaimRow>((from, to) =>
      context.supabase
        .from("claims")
        .select(CLAIM_SELECT)
        .eq("client_id", policy.client_id)
        .order("date_of_loss", { ascending: false, nullsFirst: false })
        .order("id")
        .range(from, to),
    );
    const claims = claimRows
      .map((c) => toClaim(c, clientName))
      .filter((c) => isClaimOnPolicy(c, policy));
    return { policy, claims, totals: policyTotals(claims) };
  });
