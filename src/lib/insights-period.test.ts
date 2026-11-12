import { describe, expect, it } from "vitest";
import {
  addYears,
  claimsInRange,
  currentPolicyTerm,
  parseInsightsPeriod,
  parseIsoDate,
  percentChange,
  priorRange,
  resolvePeriod,
  timeBuckets,
} from "@/lib/insights-period";

const TODAY = "2026-11-12";

describe("parseIsoDate / parseInsightsPeriod", () => {
  it("accepts only real calendar dates", () => {
    expect(parseIsoDate("2024-02-29")).toBe("2024-02-29");
    expect(parseIsoDate("2026-02-29")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("11/12/2026")).toBeNull();
    expect(parseIsoDate(20261112)).toBeNull();
  });

  it("defaults unknown periods to all time", () => {
    expect(parseInsightsPeriod("ytd")).toBe("ytd");
    expect(parseInsightsPeriod("forever")).toBe("all");
  });
});

describe("resolvePeriod", () => {
  const policies = [
    { effective_date: "2025-06-01", expiry_date: "2026-06-01" },
    { effective_date: "2026-06-01", expiry_date: "2027-06-01" },
    { effective_date: null, expiry_date: "2027-01-01" },
  ];

  it("covers year to date, the last 12 months and the policy year in force", () => {
    expect(resolvePeriod({ period: "all", today: TODAY })).toBeNull();
    expect(resolvePeriod({ period: "ytd", today: TODAY })).toEqual({
      from: "2026-01-01",
      to: TODAY,
    });
    expect(resolvePeriod({ period: "last12", today: TODAY })).toEqual({
      from: "2025-11-13",
      to: TODAY,
    });
    expect(resolvePeriod({ period: "policy", today: TODAY, policies })).toEqual({
      from: "2026-06-01",
      to: "2027-06-01",
    });
  });

  it("needs a valid custom range", () => {
    expect(resolvePeriod({ period: "custom", from: "2026-01-01", to: "2026-03-31" })).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
    expect(resolvePeriod({ period: "custom", from: "2026-04-01", to: "2026-03-31" })).toBeNull();
    expect(resolvePeriod({ period: "custom", from: "2026-04-01" })).toBeNull();
  });

  it("has no policy year when no term contains today", () => {
    expect(
      currentPolicyTerm([{ effective_date: "2020-01-01", expiry_date: "2021-01-01" }], TODAY),
    ).toBeNull();
  });

  it("compares with the same stretch a year earlier", () => {
    expect(priorRange({ from: "2026-01-01", to: TODAY })).toEqual({
      from: "2025-01-01",
      to: "2025-11-12",
    });
    expect(addYears("2024-02-29", -1)).toBe("2023-02-28");
  });
});

describe("claimsInRange", () => {
  const claims = [
    { id: "a", date_of_loss: "2026-01-01" },
    { id: "b", date_of_loss: "2025-12-31" },
    { id: "c", date_of_loss: null },
  ];
  it("keeps both ends and drops claims without a date unless it's all time", () => {
    expect(claimsInRange(claims, { from: "2026-01-01", to: TODAY }).map((c) => c.id)).toEqual([
      "a",
    ]);
    expect(claimsInRange(claims, null).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});

describe("timeBuckets", () => {
  it("uses months, clipped to the range, for up to two years", () => {
    const buckets = timeBuckets({ from: "2026-01-15", to: "2026-03-10" }, []);
    expect(buckets).toEqual([
      { key: "2026-01", range: { from: "2026-01-15", to: "2026-01-31" } },
      { key: "2026-02", range: { from: "2026-02-01", to: "2026-02-28" } },
      { key: "2026-03", range: { from: "2026-03-01", to: "2026-03-10" } },
    ]);
  });

  it("uses years for longer ranges and for all time", () => {
    expect(timeBuckets({ from: "2020-01-01", to: "2026-11-12" }, []).map((b) => b.key)).toEqual([
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
      "2025",
      "2026",
    ]);
    expect(
      timeBuckets(null, [
        { date_of_loss: "2024-05-01" },
        { date_of_loss: null },
        { date_of_loss: "2022-01-01" },
      ]).map((b) => b.key),
    ).toEqual(["2022", "2024"]);
  });
});

describe("percentChange", () => {
  it("is null without a prior figure", () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(15, 10)).toBe(50);
  });
});
