import {
  getCustomers,
  getCustomer,
  getCustomerPolicies,
  getCustomerClaims,
  type VertaforeCustomer,
} from "./client.server";

export interface AgencyClient {
  id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  ams360_id: string;
  claims_count: number;
}

export interface AgencyPolicy {
  id: string;
  client_id: string;
  policy_number: string;
  carrier: string | null;
  policy_type: string | null;
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

function displayName(c: VertaforeCustomer): string {
  return (
    c.FirmName?.trim() ||
    c.DoingBusinessAs?.trim() ||
    `${c.FirstName ?? ""} ${c.Last ?? ""}`.trim() ||
    `Customer #${c.CustomerNumber}`
  );
}

function phone(c: VertaforeCustomer): string | null {
  if (!c.BusinessPhone) return null;
  const areaCode = c.BusinessAreaCode ? `(${c.BusinessAreaCode}) ` : "";
  const ext = c.BusinessExtension ? ` x${c.BusinessExtension}` : "";
  return `${areaCode}${c.BusinessPhone}${ext}`;
}

const CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchCustomerData(customer: VertaforeCustomer) {
  const [policies, claims] = await Promise.all([
    getCustomerPolicies(customer.CustomerId).catch((e) => {
      console.error(`[vertafore] policies failed for ${customer.CustomerId}:`, e?.message ?? e);
      return [];
    }),
    getCustomerClaims(customer.CustomerId).catch((e) => {
      console.error(`[vertafore] claims failed for ${customer.CustomerId}:`, e?.message ?? e);
      return [];
    }),
  ]);
  return { customer, policies, claims };
}

function buildOverview(
  perCustomer: Awaited<ReturnType<typeof fetchCustomerData>>[],
): AgencyOverview {
  const clients: AgencyClient[] = [];
  const policies: AgencyPolicy[] = [];
  const claims: AgencyClaim[] = [];

  for (const { customer, policies: customerPolicies, claims: customerClaims } of perCustomer) {
    const name = displayName(customer);

    clients.push({
      id: customer.CustomerId,
      name,
      company_name: customer.FirmName || null,
      email: customer.EMail || null,
      phone: phone(customer),
      ams360_id: String(customer.CustomerNumber),
      claims_count: customerClaims.length,
    });

    for (const p of customerPolicies) {
      policies.push({
        id: p.PolicyId,
        client_id: customer.CustomerId,
        policy_number: p.PolicyNumber,
        carrier: p.WritingCompanyName || null,
        policy_type: p.PolicyTypeLOB || null,
      });
    }

    for (const c of customerClaims) {
      claims.push({
        id: c.ClaimId,
        claim_number: c.ClaimNo || null,
        claim_type: c.KindOfLoss || c.LineOfBusinessDescription || "Other",
        line_of_business_description: c.LineOfBusinessDescription || null,
        status: c.ClaimStatus || "Unknown",
        carrier: c.Company || null,
        date_of_loss: c.DateOfLoss,
        closed_date: c.ClosedDate,
        date_reported: c.ReportDate,
        paid_amount: c.AmountPaid,
        adjuster_name: c.EmployeeName || null,
        policy_number: c.PolicyNumber || null,
        description: c.LossDescCLHis || null,
        client_id: customer.CustomerId,
        client_name: name,
      });
    }
  }

  claims.sort((a, b) => {
    if (!a.date_of_loss) return 1;
    if (!b.date_of_loss) return -1;
    return b.date_of_loss.localeCompare(a.date_of_loss);
  });

  return { clients, policies, claims };
}

export async function getAgencyOverview(): Promise<AgencyOverview> {
  const customers = await getCustomers();
  const perCustomer = await mapWithConcurrency(customers, CONCURRENCY, fetchCustomerData);
  return buildOverview(perCustomer);
}

// Single-customer version for client-role accounts — only fetches the one
// customer's policies/claims instead of fanning out across the whole agency.
export async function getCustomerOverview(customerId: string): Promise<AgencyOverview> {
  const customer = await getCustomer(customerId);
  const data = await fetchCustomerData(customer);
  return buildOverview([data]);
}
