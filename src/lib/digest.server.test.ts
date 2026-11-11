import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the service-role client: records every builder call per
// table and answers with whatever rows the test set for that table.
type Call = [method: string, ...args: unknown[]];
const calls: Record<string, Call[][]> = {};
let tableRows: Record<string, unknown[]> = {};

function builder(table: string) {
  const log: Call[] = [];
  (calls[table] ??= []).push(log);
  const result = () => Promise.resolve({ data: tableRows[table] ?? [], error: null });
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_, prop: string) {
        if (prop === "then") return (resolve: (v: unknown) => unknown) => result().then(resolve);
        if (prop === "maybeSingle") {
          return () => Promise.resolve({ data: (tableRows[table] ?? [])[0] ?? null, error: null });
        }
        return (...args: unknown[]) => {
          log.push([prop, ...args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => builder(table),
    auth: { admin: { getUserById: vi.fn() } },
  },
}));
const sendViaResend = vi.fn();
vi.mock("@/lib/claim-notifications.server", () => ({
  sendViaResend: (...args: unknown[]) => sendViaResend(...args),
}));
vi.mock("@/lib/load-dev-vars.server", () => ({ loadDevVars: async () => {} }));

const { loadClientDigestData, runWeeklyDigest } = await import("./digest.server");

const NOW = new Date("2026-11-09T13:00:00Z");

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
  tableRows = {};
  sendViaResend.mockReset();
});

describe("loadClientDigestData", () => {
  it("filters every query by the client and drops rows from other clients", async () => {
    tableRows = {
      claims: [
        { id: "a1", client_id: "client-a", status: "open", created_at: "2026-11-08T00:00:00Z" },
        // A row the query should never have returned; it must still be dropped.
        { id: "b1", client_id: "client-b", status: "open", created_at: "2026-11-08T00:00:00Z" },
      ],
      claim_activity: [
        { claim_id: "a1", kind: "status_change", body: "A", created_at: "2026-11-08T00:00:00Z" },
        { claim_id: "b1", kind: "status_change", body: "B", created_at: "2026-11-08T00:00:00Z" },
      ],
      claim_document_requests: [
        { claim_id: "b1", name: "Other", requested_at: "2026-11-01T00:00:00Z", fulfilled_at: null },
      ],
    };

    const data = await loadClientDigestData("client-a", NOW);

    expect(calls.claims[0]).toContainEqual(["eq", "client_id", "client-a"]);
    expect(calls.claim_activity[0]).toContainEqual(["eq", "claims.client_id", "client-a"]);
    expect(calls.claim_document_requests[0]).toContainEqual(["eq", "claims.client_id", "client-a"]);
    expect(data.claims.map((c) => c.id)).toEqual(["a1"]);
    expect(data.activity.map((a) => a.body)).toEqual(["A"]);
    expect(data.documentRequests).toEqual([]);
  });
});

describe("runWeeklyDigest", () => {
  it("sends nothing and writes no runs while the agency switch is off", async () => {
    tableRows = { agency_settings: [{ weekly_digest_enabled: false }] };
    const result = await runWeeklyDigest(NOW);
    expect(result.enabled).toBe(false);
    expect(result.weekStart).toBe("2026-11-09");
    expect(sendViaResend).not.toHaveBeenCalled();
    expect(calls.client_users).toBeUndefined();
    expect(calls.digest_runs).toBeUndefined();
  });
});
