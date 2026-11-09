import { describe, expect, it } from "vitest";
import {
  STATUS_BUCKETS,
  avgClosedCost,
  compareYtd,
  countByStatus,
  incurredAmount,
  isOpen,
  netIncurred,
  openCount,
  recoveryAmount,
  statusBucket,
  summarize,
} from "@/lib/claim-metrics";
import { CLAIM_STATUSES, type ClaimStatus } from "@/lib/claim-status";

const claim = (status: ClaimStatus) => ({ status });

// The live portfolio behind the "6 open vs 9 open" report, after the backfill,
// plus one reopened claim.
const portfolio = [
  ...Array.from({ length: 22 }, () => claim("closed")),
  ...Array.from({ length: 6 }, () => claim("open")),
  ...Array.from({ length: 2 }, () => claim("submitted")),
  claim("notice"),
  claim("reopened"),
];

describe("status counts", () => {
  it("gives one answer for the reported portfolio", () => {
    expect(countByStatus(portfolio)).toEqual({
      notice: 1,
      submitted: 2,
      open: 6,
      closed: 22,
      reopened: 1,
    });
    expect(portfolio.filter(isOpen)).toHaveLength(7);
    expect(openCount(portfolio)).toBe(7);
  });

  it("has a bucket for every enum value, and only those", () => {
    expect([...STATUS_BUCKETS]).toEqual([...CLAIM_STATUSES]);
    expect(countByStatus([])).toEqual({ notice: 0, submitted: 0, open: 0, closed: 0, reopened: 0 });
  });

  it("uses the stored status as the bucket", () => {
    for (const status of CLAIM_STATUSES) expect(statusBucket(claim(status))).toBe(status);
  });

  it("counts open and reopened as open, nothing else", () => {
    expect(CLAIM_STATUSES.filter((s) => isOpen(claim(s)))).toEqual(["open", "reopened"]);
  });
});

const money = (
  status: ClaimStatus,
  date_of_loss: string,
  paid: number | null,
  reserve: number | null,
) => ({
  ...claim(status),
  date_of_loss,
  paid_amount: paid,
  reserve_amount: reserve,
});

describe("incurred", () => {
  it("adds the reserve to paid", () => {
    expect(incurredAmount({ paid_amount: 1000, reserve_amount: 2500 })).toBe(3500);
  });

  it("treats missing amounts as zero", () => {
    expect(incurredAmount({ paid_amount: null, reserve_amount: null })).toBe(0);
  });

  it("reconciles totals with the individual claims", () => {
    const rows = [money("open", "2026-01-01", 100, 50), money("closed", "2026-02-01", 200, null)];
    expect(summarize(rows)).toEqual({ claims: 2, paid: 300, incurred: 350 });
  });
});

describe("KPI comparisons", () => {
  it("averages cost over closed claims only", () => {
    const rows = [money("closed", "2026-01-01", 1000, 0), money("open", "2026-01-02", 0, 0)];
    expect(avgClosedCost(rows)).toBe(1000);
    expect(avgClosedCost([money("open", "2026-01-02", 0, 0)])).toBeNull();
  });

  it("compares the same stretch of each year", () => {
    const rows = [
      money("closed", "2026-03-01", 200, 0),
      money("open", "2026-06-15", 0, 0),
      money("closed", "2026-06-16", 900, 0), // after today, not yet in the period
      money("closed", "2025-03-01", 100, 0),
      money("closed", "2025-12-01", 900, 0), // later in 2025, outside the same period
    ];
    const result = compareYtd(rows, "2026-06-15");
    expect(result.currentYtd).toBe(2);
    expect(result.avgClosedYtd).toBe(200);
    expect(result.previousYear).toBe(2025);
    expect(result.countChange).toBe(100);
    expect(result.avgClosedChange).toBe(100);
  });

  it("gives no percentage without a prior period", () => {
    const result = compareYtd([money("open", "2026-03-01", 0, 0)], "2026-06-15");
    expect(result.countChange).toBeNull();
    expect(result.avgClosedChange).toBeNull();
  });
});

describe("recoveries and net incurred", () => {
  const amounts = (paid: number | null, reserve: number | null, recovery: number | null) => ({
    paid_amount: paid,
    reserve_amount: reserve,
    recovery_amount: recovery,
  });

  it("subtracts recoveries from paid plus reserve", () => {
    expect(netIncurred(amounts(1000, 500, 300))).toBe(1200);
    expect(recoveryAmount(amounts(0, 0, 300))).toBe(300);
  });

  it("treats NULL amounts as zero", () => {
    expect(netIncurred(amounts(1000, null, null))).toBe(1000);
    expect(netIncurred(amounts(null, null, null))).toBe(0);
    expect(recoveryAmount(amounts(0, 0, null))).toBe(0);
  });

  it("never goes below zero", () => {
    expect(netIncurred(amounts(100, 0, 500))).toBe(0);
  });

  it("reads numeric columns that arrive as strings", () => {
    const row = { paid_amount: "1000", reserve_amount: "0", recovery_amount: "250.00" };
    expect(netIncurred(row as never)).toBe(750);
  });
});
