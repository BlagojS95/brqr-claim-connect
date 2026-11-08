// Navigation shared by the sidebar, the mobile bottom bar and redirects (fixes 21, 22).

export const HOME_PATH = "/home";

export const REPORT_TABS = {
  lossSummary: "loss-summary",
  lossRuns: "loss-runs",
} as const;

export type ReportTab = (typeof REPORT_TABS)[keyof typeof REPORT_TABS];

export function parseReportTab(value: unknown): ReportTab {
  return value === REPORT_TABS.lossRuns ? REPORT_TABS.lossRuns : REPORT_TABS.lossSummary;
}

// The one nav item to highlight for a path: the item whose path is the longest
// match, either exactly or as a parent ("/claims" for "/claims/<id>"). So on
// "/claims/new" only "Report New Claim" is active, not "Claims" too.
export function activeNavPath(pathname: string, navPaths: readonly string[]): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  let best: string | null = null;
  for (const to of navPaths) {
    const matches = path === to || path.startsWith(to + "/");
    if (matches && (best === null || to.length > best.length)) best = to;
  }
  return best;
}
