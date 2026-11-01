import { describe, expect, it } from "vitest";
import {
  avgClosedCost,
  compareYtd,
  countByStatus,
  incurredAmount,
  isOpen,
  statusBucket,
  summarize,
} from "@/lib/claim-metrics";

const claim = (status: string, is_notice_only = false) => ({ status, is_notice_only });

// The live portfolio behind the "6 open vs 9 open" report.
const portfolio = [
  ...Array.from({ length: 22 }, () => claim("Closed")),
  ...Array.from({ length: 6 }, () => claim("Open")),
  ...Array.from({ length: 2 }, () => claim("Pending")),
  claim("Pending", true),
];

describe("status counts", () => {
  it("gives one answer for the reported portfolio", () => {
    expect(countByStatus(portfolio)).toEqual({ Open: 6, Pending: 3, Closed: 22 });
    expect(portfolio.filter(isOpen)).toHaveLength(6);
  });

  it("ignores casing from CSV files", () => {
    expect(statusBucket(claim("CLOSED"))).toBe("Closed");
    expect(statusBucket(claim("pending"))).toBe("Pending");
    expect(statusBucket(claim("open"))).toBe("Open");
  });

  it("treats notices as pending until they close", () => {
    expect(statusBucket(claim("Open", true))).toBe("Pending");
    expect(statusBucket(claim("Closed", true))).toBe("Closed");
  });

  it("counts other active statuses as open", () => {
    expect(statusBucket(claim("Under Review"))).toBe("Open");
  });
});

const money = (
  status: string,
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
    const rows = [money("Open", "2026-01-01", 100, 50), money("Closed", "2026-02-01", 200, null)];
    expect(summarize(rows)).toEqual({ claims: 2, paid: 300, incurred: 350 });
  });
});

describe("KPI comparisons", () => {
  it("averages cost over closed claims only", () => {
    const rows = [money("Closed", "2026-01-01", 1000, 0), money("Open", "2026-01-02", 0, 0)];
    expect(avgClosedCost(rows)).toBe(1000);
    expect(avgClosedCost([money("Open", "2026-01-02", 0, 0)])).toBeNull();
  });

  it("compares the same stretch of each year", () => {
    const rows = [
      money("Closed", "2026-03-01", 200, 0),
      money("Open", "2026-06-15", 0, 0),
      money("Closed", "2026-06-16", 900, 0), // after today, not yet in the period
      money("Closed", "2025-03-01", 100, 0),
      money("Closed", "2025-12-01", 900, 0), // later in 2025, outside the same period
    ];
    const result = compareYtd(rows, "2026-06-15");
    expect(result.currentYtd).toBe(2);
    expect(result.previousYear).toBe(2025);
    expect(result.countChange).toBe(100);
    expect(result.avgClosedChange).toBe(100);
  });

  it("gives no percentage without a prior period", () => {
    const result = compareYtd([money("Open", "2026-03-01", 0, 0)], "2026-06-15");
    expect(result.countChange).toBeNull();
    expect(result.avgClosedChange).toBeNull();
  });
});
