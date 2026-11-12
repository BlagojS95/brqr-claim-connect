import { describe, expect, it } from "vitest";
import { incurredAmount, paidAmount } from "@/lib/claim-metrics";
import {
  INSIGHTS_MEASURES,
  measureNoun,
  parseInsightsMeasure,
  totalsBy,
} from "@/lib/insights-measure";

describe("parseInsightsMeasure", () => {
  it("accepts every measure", () => {
    for (const measure of INSIGHTS_MEASURES) expect(parseInsightsMeasure(measure)).toBe(measure);
  });

  it("defaults to count for anything else", () => {
    expect(parseInsightsMeasure(undefined)).toBe("count");
    expect(parseInsightsMeasure("")).toBe("count");
    expect(parseInsightsMeasure("PAID")).toBe("count");
    expect(parseInsightsMeasure(["paid"])).toBe("count");
  });
});

describe("measureNoun", () => {
  it("names the measure for chart titles", () => {
    expect(measureNoun("count")).toBe("Claims");
    expect(measureNoun("paid")).toBe("Paid");
    expect(measureNoun("incurred")).toBe("Incurred");
  });
});

describe("totalsBy", () => {
  const claims = [
    { carrier: "A", paid_amount: 100, reserve_amount: 50 },
    { carrier: "A", paid_amount: null, reserve_amount: 25 },
    { carrier: "B", paid_amount: 10, reserve_amount: null },
    { carrier: null, paid_amount: 999, reserve_amount: 999 },
  ];

  it("totals count, paid and incurred per group with the claim-metrics helpers", () => {
    const groups = totalsBy(claims, (c) => c.carrier);
    expect(groups.get("A")).toEqual({
      count: 2,
      paid: paidAmount(claims[0]) + paidAmount(claims[1]),
      incurred: incurredAmount(claims[0]) + incurredAmount(claims[1]),
    });
    expect(groups.get("A")).toEqual({ count: 2, paid: 100, incurred: 175 });
    expect(groups.get("B")).toEqual({ count: 1, paid: 10, incurred: 10 });
  });

  it("leaves out claims with no key", () => {
    expect(totalsBy(claims, (c) => c.carrier).size).toBe(2);
  });
});
