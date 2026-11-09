import { queryOptions } from "@tanstack/react-query";
import type { AgencyOverview, OverviewScope } from "@/lib/overview.types";

// One key per dataset, so every page and component that shows the same data
// shares one cache entry (and one in-flight request) instead of each fetching
// it under its own name. The cache is cleared when the signed-in user changes
// (see AuthProvider in src/hooks/use-auth.ts), so keys don't carry the user id.
export const queryKeys = {
  // Prefix of every fetchAgencyOverview query; invalidate this after imports
  // or account changes to refresh all scopes at once.
  overviewAll: ["overview"] as const,
  overview: (scope: OverviewScope) => ["overview", scope] as const,
  claim: (claimId: string) => ["claim", claimId] as const,
  // Under the claim's own key, so invalidating claim(id) also refreshes the log.
  claimActivity: (claimId: string) => ["claim", claimId, "activity"] as const,
  // Home's "Needs your attention" list (fix 29), from fetchAttentionQueue.
  attention: ["attention"] as const,
};

type FetchOverview = (opts: { data: { scope: OverviewScope } }) => Promise<AgencyOverview>;

// The shared query for fetchAgencyOverview. Callers pick the part they need with
// `select`, so the cached value under a key is always the full overview.
export function overviewQueryOptions(scope: OverviewScope, fetchOverview: FetchOverview) {
  return queryOptions({
    queryKey: queryKeys.overview(scope),
    queryFn: () => fetchOverview({ data: { scope } }),
  });
}
