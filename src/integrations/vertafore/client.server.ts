// Server-only AMS360 (Vertafore) API client. Never import from client code.
import { loadDevVars } from "@/lib/load-dev-vars.server";

await loadDevVars();

const TOKEN_URL = "https://api.vertafore.com/oauth/clienttoken/issue/v1/";
const API_BASE = "https://api.vertafore.com/authgrant/v1/api";

export interface VertaforeCustomer {
  CustomerId: string;
  CustomerNumber: number;
  CustomerType: string;
  IsCommercialCustomer: boolean;
  IsActive: boolean;
  FirmName: string;
  FirstName: string;
  Last: string;
  DoingBusinessAs: string;
  AddressLine1: string;
  AddressLine2: string;
  City: string;
  State: string;
  ZipCode: string;
  EMail: string;
  BusinessAreaCode: string;
  BusinessPhone: string;
  BusinessExtension: string;
  AccountExecCodeDisplay: string;
}

export interface VertaforePolicy {
  PolicyId: string;
  PolicyNumber: string;
  WritingCompanyName: string;
  PolicyTypeLOB: string;
  UILineOfBusinessCodes: string;
  TypeOfBusinessDisplay: string;
  Status: string;
  EffectiveDate: string | null;
  ExpiryDate: string | null;
}

export interface VertaforeClaim {
  ClaimId: string;
  ClaimNo: string;
  ClaimStatus: string;
  ClosedDate: string | null;
  CLossHistId: string;
  Company: string;
  CustomerId: string;
  DateOfLoss: string | null;
  EmployeeName: string;
  KindOfLoss: string;
  LineOfBusiness: string;
  LineOfBusinessDescription: string;
  LossDescCLHis: string;
  AmountPaid: number | null;
  PolicyEffectiveDate: string | null;
  PolicyExpireDate: string | null;
  PolicyNumber: string;
  ReportDate: string | null;
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing Vertafore environment variable: ${name}`);
  return value;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;
let inFlightTokenRequest: Promise<string> | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }
  // Dozens of parallel per-customer requests all need a token at once — without this,
  // each one races past the (not-yet-populated) cache check and fires its own token
  // request. Share a single in-flight request so concurrent callers wait on the same one.
  if (inFlightTokenRequest) {
    return inFlightTokenRequest;
  }

  inFlightTokenRequest = (async () => {
    const user = getEnv("VERTAFORE_AUTH_USER");
    const password = getEnv("VERTAFORE_AUTH_PASSWORD");
    const email = getEnv("VERTAFORE_EMAIL");
    const instanceId = getEnv("VERTAFORE_INSTANCE_ID");

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${user}:${password}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ email, instanceid: instanceId }).toString(),
    });

    if (!res.ok) {
      throw new Error(`Vertafore token request failed: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = {
      accessToken: json.access_token,
      // refresh a bit early to avoid using a token that expires mid-request
      expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    };
    return cachedToken.accessToken;
  })();

  try {
    return await inFlightTokenRequest;
  } finally {
    inFlightTokenRequest = null;
  }
}

async function vertaforeGet<T>(path: string, attempt = 1): Promise<T> {
  const token = await getAccessToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    // Transient connection errors happen under high local concurrency; retry once or twice.
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 200 * attempt));
      return vertaforeGet<T>(path, attempt + 1);
    }
    throw err;
  }
  if (!res.ok) {
    throw new Error(`Vertafore API request failed (${path}): ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// Short-lived cache so bouncing between pages within the same server instance
// doesn't re-fire the same live AMS360 calls every single navigation. Claims/
// policies data doesn't change second-to-second, so a short TTL is safe.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fetcher();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function getCustomers(): Promise<VertaforeCustomer[]> {
  return cached("customers", async () => {
    const json = await vertaforeGet<{ value: VertaforeCustomer[] }>("/Customers");
    return json.value ?? [];
  });
}

export async function getCustomer(customerId: string): Promise<VertaforeCustomer> {
  return cached(`customer:${customerId}`, () => vertaforeGet<VertaforeCustomer>(`/Customers(${customerId})`));
}

export async function getCustomerPolicies(customerId: string): Promise<VertaforePolicy[]> {
  return cached(`policies:${customerId}`, async () => {
    const json = await vertaforeGet<{ value: VertaforePolicy[] }>(`/Customers(${customerId})/Policies`);
    return json.value ?? [];
  });
}

export async function getCustomerClaims(customerId: string): Promise<VertaforeClaim[]> {
  return cached(`claims:${customerId}`, async () => {
    const json = await vertaforeGet<{ value: VertaforeClaim[] }>(`/Customers(${customerId})/CustomerLossHistory`);
    return json.value ?? [];
  });
}
