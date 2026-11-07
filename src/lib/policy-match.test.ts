import { describe, expect, it } from "vitest";
import { policyCoversLoss, type PolicyTerm } from "@/lib/policy-match";

const GL = "gl-line";
const AUTO = "auto-line";

const policy = (overrides: Partial<PolicyTerm> = {}): PolicyTerm => ({
  effective_date: "2026-01-01",
  expiration_date: "2026-12-31",
  line_of_business_id: GL,
  ...overrides,
});

describe("policyCoversLoss", () => {
  it("includes both ends of the term", () => {
    for (const day of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
      expect(policyCoversLoss(policy(), { dateOfLoss: day, lineOfBusinessId: GL })).toBe(true);
    }
  });

  it("excludes a loss before the term starts or after it ends", () => {
    expect(policyCoversLoss(policy(), { dateOfLoss: "2025-12-31", lineOfBusinessId: GL })).toBe(
      false,
    );
    expect(policyCoversLoss(policy(), { dateOfLoss: "2027-01-01", lineOfBusinessId: GL })).toBe(
      false,
    );
  });

  it("excludes a policy on a different line", () => {
    expect(policyCoversLoss(policy(), { dateOfLoss: "2026-06-15", lineOfBusinessId: AUTO })).toBe(
      false,
    );
  });

  it("reads timestamp-style dates by their date part", () => {
    const p = policy({ expiration_date: "2026-12-31T00:00:00+00:00" });
    expect(policyCoversLoss(p, { dateOfLoss: "2026-12-31", lineOfBusinessId: GL })).toBe(true);
  });

  it("keeps policies with missing dates or line instead of hiding them", () => {
    const loss = { dateOfLoss: "2030-05-05", lineOfBusinessId: AUTO };
    expect(
      policyCoversLoss(
        { effective_date: null, expiration_date: null, line_of_business_id: null },
        loss,
      ),
    ).toBe(true);
    expect(
      policyCoversLoss(policy({ expiration_date: null, line_of_business_id: null }), loss),
    ).toBe(true);
  });

  it("doesn't filter on parts of the loss that aren't filled in yet", () => {
    expect(policyCoversLoss(policy(), { dateOfLoss: null, lineOfBusinessId: GL })).toBe(true);
    expect(policyCoversLoss(policy(), { dateOfLoss: "2026-03-03", lineOfBusinessId: null })).toBe(
      true,
    );
  });
});
