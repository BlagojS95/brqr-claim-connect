import { describe, expect, it } from "vitest";
import { activeNavPath, parseReportTab } from "@/lib/navigation";

const NAV = [
  "/home",
  "/claims",
  "/claims/new",
  "/claims/notice",
  "/policies",
  "/insights",
  "/reports",
  "/admin",
];

describe("activeNavPath", () => {
  it("highlights exactly the matching item", () => {
    expect(activeNavPath("/home", NAV)).toBe("/home");
    expect(activeNavPath("/claims", NAV)).toBe("/claims");
    expect(activeNavPath("/reports", NAV)).toBe("/reports");
  });

  it("doesn't keep Claims active on Report New Claim or Incident Notice", () => {
    expect(activeNavPath("/claims/new", NAV)).toBe("/claims/new");
    expect(activeNavPath("/claims/notice", NAV)).toBe("/claims/notice");
  });

  it("keeps Claims active on a claim's detail page", () => {
    expect(activeNavPath("/claims/2ba41e95-f443-42ed-845a-c97c157112ac", NAV)).toBe("/claims");
  });

  it("ignores a trailing slash and doesn't match on a shared prefix", () => {
    expect(activeNavPath("/claims/", NAV)).toBe("/claims");
    expect(activeNavPath("/claimsfoo", NAV)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(activeNavPath("/login", NAV)).toBeNull();
  });
});

describe("parseReportTab", () => {
  it("defaults to the loss summary", () => {
    expect(parseReportTab(undefined)).toBe("loss-summary");
    expect(parseReportTab("nonsense")).toBe("loss-summary");
    expect(parseReportTab("loss-runs")).toBe("loss-runs");
  });
});
