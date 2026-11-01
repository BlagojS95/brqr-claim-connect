import { describe, expect, it } from "vitest";
import { normalizeClaimType, parseMoney } from "@/lib/import-mapping";

describe("parseMoney", () => {
  it("reads amounts, including accounting negatives", () => {
    expect(parseMoney("$1,250.50")).toBe(1250.5);
    expect(parseMoney("(500)")).toBe(-500);
  });

  it("treats cells with no digits as blank so stored amounts survive", () => {
    for (const cell of ["N/A", "TBD", "-", "$ -", ""]) {
      expect(parseMoney(cell)).toBeUndefined();
    }
  });
});

describe("normalizeClaimType", () => {
  it("expands short codes in any casing", () => {
    expect(normalizeClaimType("GL")).toBe("General Liability");
    expect(normalizeClaimType(" wc ")).toBe("Workers Compensation");
  });

  it("leaves causes of loss and missing values alone", () => {
    expect(normalizeClaimType("Slip and Fall")).toBe("Slip and Fall");
    expect(normalizeClaimType(undefined)).toBeUndefined();
  });
});
