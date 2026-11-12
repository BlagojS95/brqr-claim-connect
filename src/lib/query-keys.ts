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
  // The policy detail page (fix 42): the policy, its claims and totals.
  policy: (policyId: string) => ["policy", policyId] as const,
  // Under the claim's own key, so invalidating claim(id) also refreshes the log.
  claimActivity: (claimId: string) => ["claim", claimId, "activity"] as const,
  // Home's "Needs your attention" list (fix 29), from fetchAttentionQueue.
  attention: ["attention"] as const,
  claimDocumentRequests: (claimId: string) => ["claim", claimId, "document-requests"] as const,
  // The active causes_of_loss lookup rows (fix 35) for the report form.
  causesOfLoss: ["causes-of-loss"] as const,
  // The signed-in user's saved claims-list views (fix 31).
  savedClaimViews: ["saved-claim-views"] as const,
  // Settings > Users & Locations (fix 32), for a client admin.
  clientTeam: ["client-team"] as const,
  // Report share links (fixes 44 and 46) the user may manage.
  sharedReports: ["shared-reports"] as const,
};

export interface CauseOfLossOption {
  id: string;
  name: string;
}

// The lookup changes rarely, so it is fetched once per session.
export function causesOfLossQueryOptions(fetchCauses: () => Promise<CauseOfLossOption[]>) {
  return queryOptions({
    queryKey: queryKeys.causesOfLoss,
    queryFn: fetchCauses,
    staleTime: Infinity,
  });
}

type FetchOverview = (opts: { data: { scope: OverviewScope } }) => Promise<AgencyOverview>;

// The shared query for fetchAgencyOverview. Callers pick the part they need with
// `select`, so the cached value under a key is always the full overview.
export function overviewQueryOptions(scope: OverviewScope, fetchOverview: FetchOverview) {
  return queryOptions({
    queryKey: queryKeys.overview(scope),
    queryFn: () => fetchOverview({ data: { scope } }),
  });
}
