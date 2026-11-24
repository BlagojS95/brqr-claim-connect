import { describe, expect, it } from "vitest";
import { activeNavPath, landingPath, parseReportTab, STAFF_QUEUE_PATH } from "@/lib/navigation";

const NAV = [
  "/home",
  "/claims",
  "/claims/new",
  "/claims/notice",
  "/policies",
  "/insights",
  "/reports",
  "/loss-runs",
  "/admin",
];

describe("activeNavPath", () => {
  it("highlights exactly the matching item", () => {
    expect(activeNavPath("/home", NAV)).toBe("/home");
    expect(activeNavPath("/claims", NAV)).toBe("/claims");
    expect(activeNavPath("/reports", NAV)).toBe("/reports");
    expect(activeNavPath("/loss-runs", NAV)).toBe("/loss-runs");
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

  it("highlights the work queue, not Admin, on /admin/queue", () => {
    const withQueue = [...NAV, STAFF_QUEUE_PATH];
    expect(activeNavPath("/admin/queue", withQueue)).toBe("/admin/queue");
    expect(activeNavPath("/admin", withQueue)).toBe("/admin");
  });
});

describe("landingPath", () => {
  it("sends agency staff to the work queue and clients to Home", () => {
    expect(landingPath(true)).toBe("/admin/queue");
    expect(landingPath(false)).toBe("/home");
  });
});

describe("parseReportTab", () => {
  it("defaults to the loss summary", () => {
    expect(parseReportTab(undefined)).toBe("loss-summary");
    expect(parseReportTab("nonsense")).toBe("loss-summary");
  });

  it("no longer has a loss runs tab (Loss Runs is its own page)", () => {
    expect(parseReportTab("loss-runs")).toBe("loss-summary");
  });

  it("knows the renewal pack tab", () => {
    expect(parseReportTab("renewal-pack")).toBe("renewal-pack");
    expect(parseReportTab(["renewal-pack"])).toBe("loss-summary");
  });
});
