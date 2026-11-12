import { describe, expect, it } from "vitest";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";
import { claimTotals } from "@/lib/claim-metrics";
import {
  BREAKDOWN_DIMENSIONS,
  NOT_GIVEN,
  breakdownBy,
  topCompareRows,
  trendSeries,
  withPrior,
  type BreakdownClaim,
} from "@/lib/insights-breakdowns";
import { timeBuckets } from "@/lib/insights-period";

type Claim = BreakdownClaim & { date_of_loss: string | null };

const claim = (fields: Partial<Claim> = {}): Claim => ({
  status: CLAIM_STATUS.open as ClaimStatus,
  paid_amount: 100,
  reserve_amount: 50,
  line_of_business: "General Liability",
  carrier: "Chubb",
  cause_of_loss: "Fire",
  policy_number: "GL 1",
  loss_location: null,
  location_name: "Yard",
  date_of_loss: "2026-02-10",
  ...fields,
});

const CLAIMS = [
  claim(),
  claim({ carrier: null, cause_of_loss: null, policy_number: "gl1", location_name: null }),
  claim({
    line_of_business: "Business Auto",
    status: CLAIM_STATUS.closed,
    date_of_loss: "2026-03-01",
  }),
];

describe("breakdownBy (fix 45)", () => {
  it("accounts for every claim in every dimension", () => {
    const total = claimTotals(CLAIMS);
    for (const dimension of BREAKDOWN_DIMENSIONS) {
      const rows = breakdownBy(CLAIMS, dimension);
      expect(rows.reduce((s, r) => s + r.count, 0)).toBe(CLAIMS.length);
      expect(rows.reduce((s, r) => s + r.incurred, 0)).toBe(total.incurred);
    }
  });

  it("gives each row the claims-list filter a click opens, none for 'Not given'", () => {
    expect(breakdownBy(CLAIMS, "carrier")).toEqual([
      expect.objectContaining({ name: "Chubb", count: 2, filter: { carrier: "Chubb" } }),
      expect.objectContaining({ name: NOT_GIVEN, count: 1 }),
    ]);
    expect(breakdownBy(CLAIMS, "carrier")[1]).not.toHaveProperty("filter");
    expect(breakdownBy(CLAIMS, "policy")).toEqual([
      expect.objectContaining({ name: "GL 1", count: 3, filter: { policy: "GL 1" } }),
    ]);
    expect(breakdownBy(CLAIMS, "status").map((r) => [r.name, r.filter])).toEqual([
      ["Open", { status: "open" }],
      ["Closed", { status: "closed" }],
    ]);
    expect(breakdownBy(CLAIMS, "cause").find((r) => r.name === NOT_GIVEN)?.filter).toBeUndefined();
  });
});

describe("withPrior / topCompareRows", () => {
  it("joins the prior year by name, keeping groups only one period has", () => {
    const rows = withPrior(
      [{ name: "A", count: 2, paid: 0, incurred: 0 }],
      [
        { name: "A", count: 1, paid: 0, incurred: 0 },
        { name: "B", count: 4, paid: 0, incurred: 0 },
      ],
    );
    expect(rows.map((r) => [r.name, r.count, r.prior.count])).toEqual([
      ["A", 2, 1],
      ["B", 0, 4],
    ]);
  });

  it("adds the smallest groups into 'All other' for both periods", () => {
    const rows = withPrior(
      ["A", "B", "C", "D"].map((name, i) => ({ name, count: 4 - i, paid: 0, incurred: 0 })),
      ["A", "C", "D"].map((name) => ({ name, count: 1, paid: 0, incurred: 0 })),
    );
    const top = topCompareRows(rows, "count", 3, "All other");
    expect(top.map((r) => [r.name, r.count, r.prior.count])).toEqual([
      ["A", 4, 1],
      ["B", 3, 0],
      ["All other", 3, 2],
    ]);
  });
});

describe("trendSeries", () => {
  it("puts every claim in the period in one bucket, with last year's beside it", () => {
    const range = { from: "2026-01-01", to: "2026-03-31" };
    const prior = [claim({ date_of_loss: "2025-02-01" }), claim({ date_of_loss: "2025-03-31" })];
    const points = trendSeries(CLAIMS, timeBuckets(range, CLAIMS), prior);
    expect(points.map((p) => [p.key, p.count, p.prior.count])).toEqual([
      ["2026-01", 0, 0],
      ["2026-02", 2, 1],
      ["2026-03", 1, 1],
    ]);
    expect(points.reduce((s, p) => s + p.incurred, 0)).toBe(claimTotals(CLAIMS).incurred);
  });
});
