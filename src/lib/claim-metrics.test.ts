import { describe, expect, it } from "vitest";
import { countByStatus, isOpen, statusBucket } from "@/lib/claim-metrics";

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
