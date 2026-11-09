import { describe, expect, it } from "vitest";
import { CLAIM_STATUS } from "@/lib/claim-status";
import { totalIncurred, totalPaid } from "@/lib/claim-metrics";
import {
  RENEWAL_YEARS,
  buildRenewalSection,
  claimPolicyYear,
  currentPolicyYear,
  formatLossRatio,
  lossRatio,
  policyLineName,
  renewalLineChoices,
  termContains,
  type LineOfBusinessRow,
  type RenewalClaim,
  type RenewalPolicy,
} from "@/lib/renewal-pack";

const LINES: LineOfBusinessRow[] = [
  { id: "gl-id", name: "General Liability", code: "GL" },
  { id: "auto-id", name: "Business Auto", code: "AUTO" },
  { id: "wc-id", name: "Workers Compensation", code: "WC" },
];

const policy = (fields: Partial<RenewalPolicy>): RenewalPolicy => ({
  client_id: "c1",
  policy_number: "GL-1",
  policy_type: null,
  line_of_business_id: "gl-id",
  effective_date: null,
  expiry_date: null,
  premium: null,
  experience_mod: null,
  ...fields,
});

const claim = (fields: Partial<RenewalClaim> & { id: string }): RenewalClaim => ({
  claim_number: null,
  claim_type: "Slip and fall",
  claimant_name: null,
  status: CLAIM_STATUS.open,
  line_of_business: "General Liability",
  date_of_loss: null,
  paid_amount: null,
  reserve_amount: null,
  client_id: "c1",
  policy_number: null,
  ...fields,
});

// Mid-year terms, so policy year and calendar year differ.
const glTerms = [2022, 2023, 2024, 2025, 2026].map((y) =>
  policy({
    policy_number: `GL-${y}`,
    effective_date: `${y}-07-01`,
    expiry_date: `${y + 1}-07-01`,
    premium: 10000,
  }),
);

describe("termContains", () => {
  it("includes both ends and needs both dates", () => {
    const p = policy({ effective_date: "2025-07-01", expiry_date: "2026-07-01" });
    expect(termContains(p, "2025-07-01")).toBe(true);
    expect(termContains(p, "2026-07-01")).toBe(true);
    expect(termContains(p, "2026-07-02")).toBe(false);
    expect(termContains(policy({ effective_date: "2025-07-01" }), "2025-08-01")).toBe(false);
  });
});

describe("claimPolicyYear", () => {
  it("uses the policy term containing the date of loss", () => {
    expect(claimPolicyYear(claim({ id: "a", date_of_loss: "2026-03-15" }), glTerms)).toBe(2025);
    expect(claimPolicyYear(claim({ id: "b", date_of_loss: "2026-08-15" }), glTerms)).toBe(2026);
  });

  it("falls back to the calendar year without a covering policy", () => {
    expect(claimPolicyYear(claim({ id: "a", date_of_loss: "2021-03-15" }), glTerms)).toBe(2021);
    expect(claimPolicyYear(claim({ id: "b", date_of_loss: "2026-03-15" }), [])).toBe(2026);
  });

  it("only uses the claim's own client's policies", () => {
    const other = claim({ id: "a", date_of_loss: "2026-03-15", client_id: "c2" });
    expect(claimPolicyYear(other, glTerms)).toBe(2026);
  });

  it("prefers the policy number on the claim when terms overlap", () => {
    const rewrite = policy({
      policy_number: "GL-RW",
      effective_date: "2026-01-01",
      expiry_date: "2027-01-01",
    });
    const terms = [...glTerms, rewrite];
    const loss = { date_of_loss: "2026-03-15" };
    expect(claimPolicyYear(claim({ id: "a", ...loss }), terms)).toBe(2026);
    expect(claimPolicyYear(claim({ id: "b", ...loss, policy_number: "GL-2025" }), terms)).toBe(
      2025,
    );
  });

  it("is null without a date of loss", () => {
    expect(claimPolicyYear(claim({ id: "a" }), glTerms)).toBeNull();
  });
});

describe("currentPolicyYear", () => {
  it("is the term in force today, else the calendar year", () => {
    expect(currentPolicyYear(glTerms, "2026-03-01")).toBe(2025);
    expect(currentPolicyYear(glTerms, "2026-11-09")).toBe(2026);
    expect(currentPolicyYear([], "2026-11-09")).toBe(2026);
  });
});

describe("lossRatio", () => {
  it("divides incurred by premium and shows — without premium", () => {
    expect(lossRatio(5000, 10000)).toBe(0.5);
    expect(lossRatio(5000, null)).toBeNull();
    expect(lossRatio(5000, 0)).toBeNull();
    expect(formatLossRatio(0.5)).toBe("50.0%");
    expect(formatLossRatio(1.2347)).toBe("123.5%");
    expect(formatLossRatio(null)).toBe("—");
  });
});

describe("policyLineName", () => {
  it("resolves by id, then by a policy type naming a line", () => {
    expect(policyLineName(policy({}), LINES)).toBe("General Liability");
    expect(policyLineName(policy({ line_of_business_id: null, policy_type: "wc" }), LINES)).toBe(
      "Workers Compensation",
    );
    expect(
      policyLineName(policy({ line_of_business_id: null, policy_type: "Business Auto" }), LINES),
    ).toBe("Business Auto");
    expect(policyLineName(policy({ line_of_business_id: null, policy_type: "BOP" }), LINES)).toBe(
      null,
    );
  });
});

describe("buildRenewalSection", () => {
  const claims = [
    claim({ id: "a", date_of_loss: "2026-03-15", paid_amount: 1000, reserve_amount: 500 }),
    claim({ id: "b", date_of_loss: "2026-08-15", reserve_amount: 2000 }),
    claim({ id: "c", date_of_loss: "2023-01-10", paid_amount: 7000, status: CLAIM_STATUS.closed }),
    // No 2020 term, so calendar year 2021: outside the five years.
    claim({ id: "old", date_of_loss: "2021-03-01", paid_amount: 99999 }),
    claim({ id: "nodate", paid_amount: 5 }),
    claim({ id: "auto", line_of_business: "Business Auto", date_of_loss: "2026-03-15" }),
  ];
  const section = buildRenewalSection("General Liability", claims, glTerms, LINES, "2026-11-09");

  it("covers the last five policy years, newest first, current one developing", () => {
    expect(section.years.map((y) => y.year)).toEqual([2026, 2025, 2024, 2023, 2022]);
    expect(section.years).toHaveLength(RENEWAL_YEARS);
    expect(section.years.map((y) => y.developing)).toEqual([true, false, false, false, false]);
  });

  it("attributes claims to policy years and sums them with claim-metrics", () => {
    const byYear = Object.fromEntries(section.years.map((y) => [y.year, y]));
    expect(byYear[2026]).toMatchObject({ claims: 1, paid: 0, reserve: 2000, incurred: 2000 });
    expect(byYear[2025]).toMatchObject({ claims: 1, paid: 1000, reserve: 500, incurred: 1500 });
    expect(byYear[2022]).toMatchObject({ claims: 1, paid: 7000, incurred: 7000 });
    expect(byYear[2024]).toMatchObject({ claims: 0, incurred: 0, premium: 10000, lossRatio: 0 });
    expect(byYear[2025].lossRatio).toBe(0.15);
  });

  it("lists only the counted claims, newest loss first", () => {
    expect(section.claims.map((r) => [r.claim.id, r.policyYear])).toEqual([
      ["b", 2026],
      ["a", 2025],
      ["c", 2022],
    ]);
  });

  it("totals equal the sum of the years and of the listed claims", () => {
    const listed = section.claims.map((r) => r.claim);
    expect(section.totals).toEqual({
      claims: 3,
      paid: totalPaid(listed),
      reserve: 2500,
      incurred: totalIncurred(listed),
      premium: 50000,
      lossRatio: 10500 / 50000,
    });
  });

  it("shows no premium or loss ratio for years without premium; totals use only years with it", () => {
    const partial = glTerms.map((p, i) => (i < 3 ? { ...p, premium: null } : p));
    const s = buildRenewalSection("General Liability", claims, partial, LINES, "2026-11-09");
    const byYear = Object.fromEntries(s.years.map((y) => [y.year, y]));
    expect(byYear[2022].premium).toBeNull();
    expect(byYear[2022].lossRatio).toBeNull();
    // Only 2025 and 2026 have premium: (1500 + 2000) / 20000.
    expect(s.totals.premium).toBe(20000);
    expect(s.totals.lossRatio).toBe(3500 / 20000);
  });

  it("uses calendar years when the line has no policies", () => {
    const s = buildRenewalSection("Business Auto", claims, glTerms, LINES, "2026-11-09");
    expect(s.years[0]).toMatchObject({ year: 2026, claims: 1, premium: null, lossRatio: null });
    expect(s.totals.premium).toBeNull();
  });

  it("carries the WC experience mod per policy year", () => {
    const wcTerms = [
      policy({
        line_of_business_id: "wc-id",
        policy_number: "WC-25",
        effective_date: "2025-01-01",
        expiry_date: "2026-01-01",
        experience_mod: 0.92,
      }),
      policy({
        line_of_business_id: "wc-id",
        policy_number: "WC-26",
        effective_date: "2026-01-01",
        expiry_date: "2027-01-01",
      }),
    ];
    const s = buildRenewalSection("Workers Compensation", [], wcTerms, LINES, "2026-11-09");
    expect(s.isWorkersComp).toBe(true);
    expect(s.hasExperienceMods).toBe(true);
    expect(s.years[0].experienceMods).toEqual([]);
    expect(s.years[1].experienceMods).toEqual([0.92]);
    expect(section.isWorkersComp).toBe(false);
  });
});

describe("renewalLineChoices", () => {
  it("offers lines with policies or claims, ticking those with policies", () => {
    const choices = renewalLineChoices(
      [{ line_of_business: "Business Auto" }, { line_of_business: "General Liability" }],
      [policy({}), policy({ line_of_business_id: "wc-id" })],
      LINES,
    );
    expect(choices.all).toEqual(["General Liability", "Business Auto", "Workers Compensation"]);
    expect(choices.withPolicies).toEqual(["General Liability", "Workers Compensation"]);
  });
});
