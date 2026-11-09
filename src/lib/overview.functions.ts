import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseInput } from "@/lib/http-errors.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Tables } from "@/integrations/supabase/types";
import { todayIso } from "@/lib/dates";
import { LINE_OF_BUSINESS_NAMES } from "@/lib/line-of-business";
import { POLICY_STATUS, type PolicyStatus } from "@/lib/policy-status";
import { fetchAll } from "@/lib/fetch-all";
import type {
  AgencyClaim,
  AgencyClient,
  AgencyOverview,
  AgencyPolicy,
  OverviewScope,
} from "@/lib/overview.types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "YYYY-MM-DD" text sorts in date order, and the policy is in force on its expiry day.
function computePolicyStatus(effectiveDate: string | null, expiryDate: string | null): PolicyStatus {
  const today = todayIso();
  if (effectiveDate && today < effectiveDate.slice(0, 10)) return POLICY_STATUS.inactive;
  if (expiryDate && today > expiryDate.slice(0, 10)) return POLICY_STATUS.inactive;
  return POLICY_STATUS.active;
}

function displayName(client: { name?: string | null; company_name?: string | null } | null | undefined): string {
  return client?.company_name || client?.name || "";
}

type ClaimRow = Tables<"claims"> & {
  lines_of_business: { name: string } | null;
  causes_of_loss: { name: string } | null;
};

function toClaim(row: ClaimRow, clientName: string): AgencyClaim {
  return {
    id: row.id,
    claim_number: row.claim_number,
    claim_type: row.claim_type,
    // ?? null: rows read before the claimant_name migration has been applied
    claimant_name: row.claimant_name ?? null,
    line_of_business: row.lines_of_business?.name ?? LINE_OF_BUSINESS_NAMES.OTHER,
    status: row.status,
    is_notice_only: row.is_notice_only,
    carrier: row.carrier,
    date_of_loss: row.date_of_loss,
    closed_date: row.closed_date,
    date_reported: row.date_reported,
    paid_amount: row.paid_amount,
    reserve_amount: row.reserve_amount,
    recovery_amount: row.recovery_amount ?? null,
    adjuster_name: row.adjuster_name,
    policy_number: row.policy_number,
    description: row.description,
    client_id: row.client_id,
    client_name: clientName,
    waiting_on: row.waiting_on ?? null,
    last_activity_at: row.last_activity_at ?? null,
    created_at: row.created_at,
    cause_of_loss_id: row.cause_of_loss_id ?? null,
    cause_of_loss: row.causes_of_loss?.name ?? null,
    loss_location: row.loss_location ?? null,
    employee_name: row.employee_name ?? null,
    driver_name: row.driver_name ?? null,
    vehicles_involved: row.vehicles_involved ?? null,
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
      : fetchAll<ClaimRow>((from, to) =>
          supabase
            .from("claims")
            .select("*, lines_of_business(name), causes_of_loss(name)")
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
    line_of_business_id: p.line_of_business_id ?? null,
    effective_date: p.effective_date,
    expiry_date: p.expiration_date,
    premium: p.premium,
    experience_mod: p.experience_mod ?? null,
    status: computePolicyStatus(p.effective_date, p.expiration_date),
  }));

  const claims = claimRows.map((c) => toClaim(c, clientNames.get(c.client_id) ?? ""));

  return { clients, policies, claims };
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
      .select("*, clients(name, company_name), lines_of_business(name), causes_of_loss(name)")
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
