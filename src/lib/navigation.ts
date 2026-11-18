// Navigation shared by the sidebar, the mobile bottom bar and redirects (fixes 21, 22).

export const HOME_PATH = "/home";

// The staff work queue (fix 52), where agency admins land after signing in.
export const STAFF_QUEUE_PATH = "/admin/queue";

/** Where a user starts: agency staff on their work queue, clients on Home. */
export function landingPath(isAgencyAdmin: boolean): typeof HOME_PATH | typeof STAFF_QUEUE_PATH {
  return isAgencyAdmin ? STAFF_QUEUE_PATH : HOME_PATH;
}

export const REPORT_TABS = {
  lossSummary: "loss-summary",
  lossRuns: "loss-runs",
  renewalPack: "renewal-pack",
  executiveReport: "executive-report",
} as const;

export type ReportTab = (typeof REPORT_TABS)[keyof typeof REPORT_TABS];

const REPORT_TAB_VALUES: readonly string[] = Object.values(REPORT_TABS);

/** Unknown or missing tabs open the loss summary. */
export function parseReportTab(value: unknown): ReportTab {
  return typeof value === "string" && REPORT_TAB_VALUES.includes(value)
    ? (value as ReportTab)
    : REPORT_TABS.lossSummary;
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
