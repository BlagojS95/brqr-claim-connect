import { describe, expect, it } from "vitest";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";
import { incurredAmount, paidAmount, reserveAmount } from "@/lib/claim-metrics";
import { isClaimOnPolicy, policyNumberKey, policyTotals } from "@/lib/policy-claims";

const POLICY = { id: "p1", client_id: "c1", policy_number: "GL 1001" };

const claim = (fields: {
  client_id?: string;
  policy_id?: string | null;
  policy_number?: string | null;
  status?: ClaimStatus;
  paid_amount?: number | null;
  reserve_amount?: number | null;
}) => ({
  client_id: "c1",
  policy_id: null,
  policy_number: null,
  status: CLAIM_STATUS.open,
  paid_amount: null,
  reserve_amount: null,
  ...fields,
});

describe("isClaimOnPolicy", () => {
  it("matches the policy it was filed on", () => {
    expect(isClaimOnPolicy(claim({ policy_id: "p1" }), POLICY)).toBe(true);
    expect(isClaimOnPolicy(claim({ policy_id: "p2", policy_number: "GL 1001" }), POLICY)).toBe(
      false,
    );
  });

  it("matches the policy number ignoring case and spaces", () => {
    expect(isClaimOnPolicy(claim({ policy_number: " gl1001 " }), POLICY)).toBe(true);
    expect(isClaimOnPolicy(claim({ policy_number: "GL 1002" }), POLICY)).toBe(false);
    expect(isClaimOnPolicy(claim({ policy_number: null }), POLICY)).toBe(false);
  });

  it("never matches another client's claim", () => {
    expect(isClaimOnPolicy(claim({ client_id: "c2", policy_number: "GL 1001" }), POLICY)).toBe(
      false,
    );
    expect(isClaimOnPolicy(claim({ client_id: "c2", policy_id: "p1" }), POLICY)).toBe(false);
  });

  it("keys policy numbers without spaces, lower-case", () => {
    expect(policyNumberKey(" GL 10 01 ")).toBe("gl1001");
    expect(policyNumberKey(null)).toBe("");
  });
});

describe("policyTotals", () => {
  it("equals the sum of its claims", () => {
    const claims = [
      claim({ paid_amount: 1000, reserve_amount: 500 }),
      claim({ status: CLAIM_STATUS.closed, paid_amount: 2500.5, reserve_amount: null }),
      claim({ status: CLAIM_STATUS.reopened, paid_amount: null, reserve_amount: 750 }),
    ];
    const totals = policyTotals(claims);
    expect(totals).toEqual({
      claims: 3,
      open: 2,
      paid: claims.reduce((s, c) => s + paidAmount(c), 0),
      reserve: claims.reduce((s, c) => s + reserveAmount(c), 0),
      incurred: claims.reduce((s, c) => s + incurredAmount(c), 0),
    });
    expect(totals.incurred).toBe(totals.paid + totals.reserve);
  });

  it("is all zero for a policy without claims", () => {
    expect(policyTotals([])).toEqual({ claims: 0, open: 0, paid: 0, reserve: 0, incurred: 0 });
  });
});
