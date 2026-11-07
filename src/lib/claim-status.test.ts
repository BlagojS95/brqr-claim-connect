import { describe, expect, it } from "vitest";
import {
  CLAIM_STATUSES,
  CLAIM_STATUS_LABELS,
  claimStatusLabel,
  isClaimStatus,
  parseClaimStatus,
} from "@/lib/claim-status";

describe("parseClaimStatus (CSV import)", () => {
  it("maps Pending by whether the carrier has given a claim number", () => {
    expect(parseClaimStatus("Pending", null)).toBe("submitted");
    expect(parseClaimStatus("Pending", "  ")).toBe("submitted");
    expect(parseClaimStatus("Pending", "CLM-1")).toBe("open");
  });

  it("maps closed, reopened and notice text", () => {
    expect(parseClaimStatus("Closed", null)).toBe("closed");
    expect(parseClaimStatus("CLOSED - Paid", "1")).toBe("closed");
    expect(parseClaimStatus("Reopened", "1")).toBe("reopened");
    expect(parseClaimStatus("Re-opened", "1")).toBe("reopened");
    expect(parseClaimStatus("re open", "1")).toBe("reopened");
    expect(parseClaimStatus("Notice Only", null)).toBe("notice");
    expect(parseClaimStatus("submitted", null)).toBe("submitted");
  });

  it("counts open and other in-progress text as open", () => {
    expect(parseClaimStatus("Open", null)).toBe("open");
    expect(parseClaimStatus("open", "1")).toBe("open");
    expect(parseClaimStatus("Under Review", null)).toBe("open");
    expect(parseClaimStatus("something unexpected", null)).toBe("open");
  });

  it("leaves a blank cell alone", () => {
    expect(parseClaimStatus(undefined, "1")).toBeUndefined();
    expect(parseClaimStatus("   ", "1")).toBeUndefined();
  });

  it("always returns an enum value", () => {
    for (const text of ["Open", "Pending", "Closed", "Reopened", "Notice", "Denied", "?"]) {
      expect(isClaimStatus(parseClaimStatus(text, null))).toBe(true);
    }
  });
});

describe("labels", () => {
  it("has a label for every status", () => {
    expect(Object.keys(CLAIM_STATUS_LABELS)).toEqual([...CLAIM_STATUSES]);
    expect(claimStatusLabel("submitted")).toBe("Submitted");
  });
});
