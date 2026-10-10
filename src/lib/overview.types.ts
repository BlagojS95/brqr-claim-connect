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
  effective_date: string | null;
  expiry_date: string | null;
  premium: number | null;
  status: "Active" | "Non Active";
}

export interface AgencyClaim {
  id: string;
  claim_number: string | null;
  claim_type: string;
  line_of_business_description: string | null;
  status: string;
  carrier: string | null;
  date_of_loss: string | null;
  closed_date: string | null;
  date_reported: string | null;
  paid_amount: number | null;
  adjuster_name: string | null;
  policy_number: string | null;
  description: string | null;
  client_id: string;
  client_name: string;
}

export interface AgencyOverview {
  clients: AgencyClient[];
  policies: AgencyPolicy[];
  claims: AgencyClaim[];
}

export type OverviewScope = "all" | "claims" | "policies";
