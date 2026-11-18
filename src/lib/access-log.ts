// Fix 51: the access log (who signed in, opened or changed a claim, downloaded
// or shared a report). Rows are written only on the server
// (access-log.server.ts); this file holds what the browser needs too.

export const ACCESS_ACTION = {
  signIn: "sign_in",
  viewClaim: "view_claim",
  editClaim: "edit_claim",
  addNote: "add_note",
  download: "download",
  share: "share",
} as const;
export type AccessAction = (typeof ACCESS_ACTION)[keyof typeof ACCESS_ACTION];

const ACTION_LABELS: Record<AccessAction, string> = {
  sign_in: "Signed in",
  view_claim: "Viewed claim",
  edit_claim: "Edited claim",
  add_note: "Added a note",
  download: "Downloaded",
  share: "Created a share link",
};

/** Label for an action; an unknown one (added later) is shown readably. */
export function accessActionLabel(action: string): string {
  if (Object.prototype.hasOwnProperty.call(ACTION_LABELS, action)) {
    return ACTION_LABELS[action as AccessAction];
  }
  const words = action.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Unknown";
}

export const ACCESS_LOG_PAGE_SIZE = 50;
/** The database allows 500; longer detail is cut with an ellipsis. */
export const ACCESS_DETAIL_MAX = 500;

export function clampDetail(detail: string | null | undefined): string | null {
  const text = detail?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= ACCESS_DETAIL_MAX ? text : `${text.slice(0, ACCESS_DETAIL_MAX - 1)}…`;
}

/** Row range for a page, for PostgREST .range(from, to) (inclusive). */
export function pageRange(page: number, pageSize = ACCESS_LOG_PAGE_SIZE): [number, number] {
  const p = Number.isInteger(page) && page > 0 ? page : 0;
  return [p * pageSize, p * pageSize + pageSize - 1];
}

/** Number of pages for a row count; at least 1 so "Page 1 of 1" reads right when empty. */
export function pageCount(total: number, pageSize = ACCESS_LOG_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

export interface AccessLogEntry {
  id: string;
  /** "Acme Co (Jane Smith)", "BRQR Agency", ... */
  who: string;
  action: string;
  actionLabel: string;
  claimId: string | null;
  claimNumber: string | null;
  clientName: string | null;
  detail: string | null;
  createdAt: string;
}

export interface AccessLogPage {
  entries: AccessLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  /** Agency staff only: the clients to filter by. */
  clients: { id: string; name: string }[] | null;
}

/** "Claim HFD-2026-42907", or "Claim" when it has no number yet. */
export function claimLinkText(claimNumber: string | null): string {
  return claimNumber?.trim() ? `Claim ${claimNumber.trim()}` : "Claim";
}
