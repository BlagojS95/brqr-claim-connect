import { describe, expect, it, vi } from "vitest";
import { matchQuery } from "@tanstack/react-query";
import { classifySessionChange } from "@/hooks/use-auth";
import { overviewQueryOptions, queryKeys } from "@/lib/query-keys";
import type { AgencyOverview } from "@/lib/overview.types";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

describe("queryKeys", () => {
  it("gives every caller of a scope the same overview key", () => {
    const fetch = vi.fn(async () => ({}) as AgencyOverview);
    expect(overviewQueryOptions("claims", fetch).queryKey).toEqual(queryKeys.overview("claims"));
    expect(overviewQueryOptions("claims", fetch).queryKey).toEqual(
      overviewQueryOptions("claims", vi.fn()).queryKey,
    );
    expect(queryKeys.overview("claims")).not.toEqual(queryKeys.overview("policies"));
  });

  it("asks the server for the scope in the key", async () => {
    const fetch = vi.fn(async () => ({}) as AgencyOverview);
    const opts = overviewQueryOptions("policies", fetch);
    await (opts.queryFn as () => Promise<unknown>)();
    expect(fetch).toHaveBeenCalledWith({ data: { scope: "policies" } });
  });

  it("invalidating overviewAll hits every overview scope", () => {
    for (const scope of ["all", "claims", "policies"] as const) {
      const query = { queryKey: queryKeys.overview(scope), queryHash: "" };
      expect(matchQuery({ queryKey: queryKeys.overviewAll }, query as never)).toBe(true);
    }
  });

  it("keeps the attention queue apart from the overview", () => {
    const query = { queryKey: queryKeys.attention, queryHash: "" };
    expect(matchQuery({ queryKey: queryKeys.overviewAll }, query as never)).toBe(false);
  });

  it("nests a claim's activity under the claim key", () => {
    const query = { queryKey: queryKeys.claimActivity("c1"), queryHash: "" };
    expect(matchQuery({ queryKey: queryKeys.claim("c1") }, query as never)).toBe(true);
  });
});

describe("classifySessionChange", () => {
  it("loads the role on the first session", () => {
    expect(classifySessionChange(undefined, "u1")).toBe("new-user");
    expect(classifySessionChange(undefined, null)).toBe("signed-out");
  });

  it("keeps the lookup for repeat events and token refreshes of the same user", () => {
    expect(classifySessionChange("u1", "u1")).toBe("same-user");
    expect(classifySessionChange(null, null)).toBe("same-user");
  });

  it("reloads when the user changes or signs out", () => {
    expect(classifySessionChange("u1", "u2")).toBe("new-user");
    expect(classifySessionChange(null, "u1")).toBe("new-user");
    expect(classifySessionChange("u1", null)).toBe("signed-out");
  });
});
