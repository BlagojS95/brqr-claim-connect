import type { ClaimStatus } from "@/lib/claim-status";
import type { Database } from "@/integrations/supabase/types";

export type WaitingOn = Database["public"]["Enums"]["claim_waiting_on"];
import type { PolicyStatus } from "@/lib/policy-status";
import type { LossDetails } from "@/lib/claim-submission";

export interface AgencyClient {
  id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  ams360_id: string | null;
  user_id: string | null;
  claims_count: number;
}

export interface AgencyPolicy {
  id: string;
  client_id: string;
  client_name: string;
  policy_number: string;
  carrier: string | null;
  policy_type: string | null;
  line_of_business_id: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  premium: number | null;
  // Workers comp experience mod for this term (fix 36), when stored.
  experience_mod: number | null;
  status: PolicyStatus;
}

export interface AgencyClaim {
  id: string;
  claim_number: string | null;
  claim_type: string;
  claimant_name: string | null;
  line_of_business: string;
  status: ClaimStatus;
  is_notice_only: boolean;
  carrier: string | null;
  date_of_loss: string | null;
  closed_date: string | null;
  date_reported: string | null;
  paid_amount: number | null;
  reserve_amount: number | null;
  // Subrogation, salvage and other money back (fix 39).
  recovery_amount: number | null;
  adjuster_name: string | null;
  policy_number: string | null;
  description: string | null;
  client_id: string;
  client_name: string;
  // Who has the ball (fix 30); null on closed claims.
  waiting_on: WaitingOn | null;
  // Newest claim_activity time (fix 30), for "days since update".
  last_activity_at: string | null;
  created_at: string;
  // Cause of loss (fix 35) from the causes_of_loss lookup.
  cause_of_loss_id: string | null;
  cause_of_loss: string | null;
  // Searchable loss details (fix 31).
  loss_location: string | null;
  employee_name: string | null;
  driver_name: string | null;
  vehicles_involved: string | null;
  // Only filled by fetchClaimDetail; the list views don't need it.
  loss_details?: LossDetails;
}

export interface AgencyOverview {
  clients: AgencyClient[];
  policies: AgencyPolicy[];
  claims: AgencyClaim[];
}

export type OverviewScope = "all" | "claims" | "policies";
