// Row mappers shared by the server functions that read claims and policies
// (overview.functions.ts, shared-reports.functions.ts). Server-only: imported
// inside server handlers, never by a page.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/integrations/supabase/types";
import { todayIso } from "@/lib/dates";
import { fetchAll } from "@/lib/fetch-all";
import { LINE_OF_BUSINESS_NAMES } from "@/lib/line-of-business";
import { POLICY_STATUS, type PolicyStatus } from "@/lib/policy-status";
import type { AgencyClaim, AgencyPolicy } from "@/lib/overview.types";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "YYYY-MM-DD" text sorts in date order, and the policy is in force on its expiry day.
export function computePolicyStatus(
  effectiveDate: string | null,
  expiryDate: string | null,
): PolicyStatus {
  const today = todayIso();
  if (effectiveDate && today < effectiveDate.slice(0, 10)) return POLICY_STATUS.inactive;
  if (expiryDate && today > expiryDate.slice(0, 10)) return POLICY_STATUS.inactive;
  return POLICY_STATUS.active;
}

export function displayName(
  client: { name?: string | null; company_name?: string | null } | null | undefined,
): string {
  return client?.company_name || client?.name || "";
}

export type ClaimRow = Tables<"claims"> & {
  lines_of_business: { name: string } | null;
  causes_of_loss: { name: string } | null;
  client_locations: { name: string } | null;
};

export type PolicyRow = Tables<"policies"> & { client_locations: { name: string } | null };

export const CLAIM_SELECT =
  "*, lines_of_business(name), causes_of_loss(name), client_locations(name)";

export function toClaim(row: ClaimRow, clientName: string): AgencyClaim {
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
    is_litigated: row.is_litigated ?? false,
    wc_claim_kind:
      row.wc_claim_kind === "lost_time" || row.wc_claim_kind === "medical_only"
        ? row.wc_claim_kind
        : null,
    adjuster_name: row.adjuster_name,
    policy_number: row.policy_number,
    policy_id: row.policy_id ?? null,
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
    location_id: row.location_id ?? null,
    location_name: row.client_locations?.name ?? null,
  };
}

export function toPolicy(p: PolicyRow, clientName: string): AgencyPolicy {
  return {
    id: p.id,
    client_id: p.client_id,
    client_name: clientName,
    policy_number: p.policy_number,
    carrier: p.carrier,
    policy_type: p.policy_type,
    line_of_business_id: p.line_of_business_id ?? null,
    effective_date: p.effective_date,
    expiry_date: p.expiration_date,
    premium: p.premium,
    experience_mod: p.experience_mod ?? null,
    location_id: p.location_id ?? null,
    location_name: p.client_locations?.name ?? null,
    status: computePolicyStatus(p.effective_date, p.expiration_date),
  };
}

/**
 * One client's claims, read with the given client's token so RLS still
 * decides which of them the caller may see. Newest loss first.
 */
export async function loadClientClaims(
  supabase: SupabaseClient<Database>,
  clientId: string,
): Promise<{ clientName: string; claims: AgencyClaim[] } | null> {
  const { data: client } = await supabase
    .from("clients")
    .select("name, company_name")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return null;
  const clientName = displayName(client);
  const rows = await fetchAll<ClaimRow>((from, to) =>
    supabase
      .from("claims")
      .select(CLAIM_SELECT)
      .eq("client_id", clientId)
      .order("date_of_loss", { ascending: false, nullsFirst: false })
      .order("id")
      .range(from, to),
  );
  return { clientName, claims: rows.map((r) => toClaim(r, clientName)) };
}
