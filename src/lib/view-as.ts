// View as client (fix 55): shared rules for the read-only session in which an
// agency admin sees a client's portal as that client does.
//
// The session itself lives only in the database (admin_view_sessions, checked
// by public.viewing_as_client). requireSupabaseAuth looks it up on every server
// function call and, while one is open, refuses every function that isn't
// listed below as safe to run while viewing. The database refuses every direct
// write as well (see the 20261116000500 migration).

export const VIEW_AS_READ_ONLY_MESSAGE = "Read-only while viewing as a client";

/** A session counts for this long at most; the database uses the same 8 hours. */
export const VIEW_SESSION_MAX_HOURS = 8;

export const VIEW_SESSION_END_REASON = {
  exit: "exit",
  signOut: "sign_out",
  replaced: "replaced",
  expired: "expired",
} as const;
export type ViewSessionEndReason =
  (typeof VIEW_SESSION_END_REASON)[keyof typeof VIEW_SESSION_END_REASON];

/**
 * What each server function does, by its variable name. Every createServerFn
 * in src/ must be listed (view-as.test.ts fails otherwise), so a new function
 * can't slip through unclassified; one missing from this list is refused while
 * viewing anyway.
 *
 * - read:         only reads what the signed-in user may see; allowed while viewing.
 * - view-session: starts/ends/reads the view-as session itself; allowed while viewing.
 * - write:        changes data, sends email or calls an outside service; refused.
 * - admin:        agency-only reads for /admin pages, not part of the client
 *                 portal; refused while viewing.
 * - public:       no sign-in (shared links); never sees a session.
 */
export type ServerFnAccess = "read" | "view-session" | "write" | "admin" | "public";

export const SERVER_FN_ACCESS: Record<string, ServerFnAccess> = {
  // accounts.functions.ts
  createClientAccount: "write",
  resetClientPassword: "write",
  deleteClientAccount: "write",
  // attention.functions.ts
  fetchAttentionQueue: "read",
  // claim-activity.functions.ts
  fetchClaimActivity: "read", // POST, but only reads
  addClaimNote: "write",
  // claim-messages.functions.ts (fix 47)
  fetchClaimMessages: "read",
  fetchMessageMentionCandidates: "read",
  postClaimMessage: "write",
  // claim-contacts.functions.ts: seeds missing contact rows, skipped while viewing.
  ensureClaimContacts: "read",
  // claim-internal-notes.functions.ts
  saveClaimInternalNote: "write",
  // claim-reserve.functions.ts
  updateClaimReserve: "write",
  updateClaimRecovery: "write",
  updateClaimReportFlags: "write",
  // claim-submission.functions.ts
  checkDuplicateClaims: "read", // POST, but only reads
  submitClaim: "write",
  processClaimNotifications: "write",
  retryClaimNotification: "write",
  // claim-watches.functions.ts (fix 48)
  fetchWatchedClaimIds: "read",
  setClaimWatch: "write",
  fetchAlertPrefs: "read",
  updateAlertPref: "write",
  // claim-waiting-on.functions.ts
  updateClaimWaitingOn: "write",
  // client-users.functions.ts
  fetchClientTeam: "read",
  inviteClientUser: "write",
  updateClientUser: "write",
  removeClientUser: "write",
  createClientLocation: "write",
  updateClientLocation: "write",
  deleteClientLocation: "write",
  setClaimLocation: "write",
  // digest.functions.ts
  fetchNotificationSettings: "read",
  updateWeeklyDigestPreference: "write",
  updateAgencyWeeklyDigest: "write",
  sendMeTestDigest: "write",
  // document-requests.functions.ts
  listDocumentRequests: "read",
  createDocumentRequest: "write",
  deleteDocumentRequest: "write",
  // email.functions.ts
  sendLossRunRequestEmail: "write",
  // executive-report.functions.ts
  generateExecutiveReport: "read", // POST, but only reads
  downloadExecutiveReport: "read", // POST, but only reads and draws the PDF
  createExecutiveReportShare: "write",
  downloadSharedExecutiveReport: "public",
  fetchReportSchedule: "read",
  setReportSchedule: "write",
  sendTestExecutiveReport: "write",
  setMonthlyReportEnabled: "write",
  // import.functions.ts
  importRows: "write",
  // insurgrid.ts
  insurGridConfigured: "read",
  createInsurGridSession: "write", // outside service; lets the user order loss runs
  // loss-runs.functions.ts
  createLossRunUpload: "write",
  attachLossRun: "write",
  fulfillLossRunRequest: "write",
  // overview.functions.ts
  fetchAgencyOverview: "read",
  fetchClaimDetail: "read",
  fetchPolicyDetail: "read",
  // saved-views.functions.ts
  listSavedViews: "read",
  createSavedView: "write",
  deleteSavedView: "write",
  // shared-reports.functions.ts
  createLossSummaryShare: "write",
  listSharedReports: "read",
  revokeSharedReport: "write",
  fetchSharedReport: "public",
  // staff.functions.ts
  fetchAgencyStaff: "admin",
  // view-as.functions.ts
  startViewAsClient: "write", // exit the current session first
  endViewAsClient: "view-session",
  fetchViewAsSession: "view-session",
  listViewAsSessions: "admin",
  // Phase 7 staff tools: agency-only, so refused while viewing as a client.
  // carrier-email.functions.ts (fix 54)
  fetchEmailTemplates: "admin",
  fetchCarrierEmailDraft: "admin",
  sendCarrierEmail: "write",
  saveEmailTemplate: "write",
  deleteEmailTemplate: "write",
  // carrier-import.functions.ts (fix 53)
  fetchCarrierImportSetup: "admin",
  fetchCarrierClaims: "admin",
  saveCarrierImportMapping: "write",
  applyCarrierImport: "write",
  // claim-quick-edit.functions.ts (fix 53)
  fetchClaimQuickEdit: "admin",
  updateClaimQuickEdit: "write",
  // response-targets.functions.ts (fix 56)
  fetchClaimResponseTimes: "admin",
  updateResponseTargets: "write",
  fetchStaffResponseMetrics: "admin",
  // staff-queue.functions.ts (fix 52)
  fetchStaffQueue: "admin",
  // Fix 51: security for client admins.
  // access-log.functions.ts
  recordSignIn: "write", // writes a log row; nothing to record while viewing
  fetchAccessLog: "read",
  recordDownload: "read", // a log row only; the function itself skips view-as sessions
  // security.functions.ts (fetchMfaStatus is also the one MFA_EXEMPT function, src/lib/mfa.ts)
  fetchMfaStatus: "read",
  fetchSecuritySettings: "read",
  setClientRequireMfa: "write",
};

/**
 * True when a server function may run while its caller is viewing as a client.
 * Unknown names (and a missing name) are refused: fail closed.
 */
export function allowedWhileViewing(fnName: string | undefined | null): boolean {
  if (!fnName || !Object.prototype.hasOwnProperty.call(SERVER_FN_ACCESS, fnName)) return false;
  const access = SERVER_FN_ACCESS[fnName];
  return access === "read" || access === "view-session";
}

export interface ViewingAs {
  clientId: string;
  clientName: string;
}

/** The banner shown on every page while viewing. */
export function viewAsBannerText(clientName: string): string {
  const name = clientName.trim() || "this client";
  return `Viewing as ${name} — read only`;
}

/** Same rule as public.viewing_as_client: open and under 8 hours old. */
export function isViewSessionOpen(
  session: { started_at: string; ended_at: string | null },
  now: Date,
): boolean {
  if (session.ended_at) return false;
  const started = Date.parse(session.started_at);
  if (Number.isNaN(started)) return false;
  return now.getTime() - started < VIEW_SESSION_MAX_HOURS * 3_600_000;
}

/** "12 min", "1 h 5 min", "< 1 min"; for the log card. */
export function formatViewDuration(startedAt: string, endedAt: string): string {
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "< 1 min";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export const VIEW_SESSION_END_LABEL: Record<ViewSessionEndReason, string> = {
  exit: "Exited",
  sign_out: "Signed out",
  replaced: "Replaced",
  expired: "Expired",
};
