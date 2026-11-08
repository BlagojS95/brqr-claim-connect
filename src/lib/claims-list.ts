// Filtering, sorting and paging for the claims list (fix 24). The list keeps
// all of this in the URL (/claims?status=open&sort=paid&dir=desc&page=2), so
// links such as Home's "Open Claims" card can point straight at a filtered view.

import {
  STATUS_BUCKETS,
  isOpen,
  paidAmount,
  reserveAmount,
  statusBucket,
  type StatusBucket,
} from "@/lib/claim-metrics";
import {
  CLAIM_STATUS,
  CLAIM_STATUS_LABELS,
  isClaimStatus,
  type ClaimStatus,
} from "@/lib/claim-status";
import type { AgencyClaim } from "@/lib/overview.types";

export const CLAIMS_PAGE_SIZE = 25;

export const CLAIM_SORT_KEYS = [
  "date",
  "type",
  "carrier",
  "status",
  "number",
  "adjuster",
  "paid",
  "reserve",
  "closed",
] as const;

export type ClaimSortKey = (typeof CLAIM_SORT_KEYS)[number];

export const SORT_DIRS = ["asc", "desc"] as const;

export type SortDir = (typeof SORT_DIRS)[number];

export const DEFAULT_CLAIM_SORT: ClaimSortKey = "date";

/** Dates and money read best newest / largest first; text columns A to Z. */
export function defaultSortDir(key: ClaimSortKey): SortDir {
  return key === "date" || key === "closed" || key === "paid" || key === "reserve" ? "desc" : "asc";
}

/** The claims list's URL search params. Every one is optional; missing means the default. */
export interface ClaimsSearch {
  status?: ClaimStatus;
  q?: string;
  sort?: ClaimSortKey;
  dir?: SortDir;
  page?: number;
}

function isSortKey(value: unknown): value is ClaimSortKey {
  return typeof value === "string" && (CLAIM_SORT_KEYS as readonly string[]).includes(value);
}

function isSortDir(value: unknown): value is SortDir {
  return value === "asc" || value === "desc";
}

/** validateSearch for /claims: unknown or malformed values are dropped, not errors. */
export function parseClaimsSearch(search: Record<string, unknown>): ClaimsSearch {
  const result: ClaimsSearch = {};
  if (isClaimStatus(search.status)) result.status = search.status;
  if (typeof search.q === "string" && search.q.trim()) result.q = search.q;
  if (isSortKey(search.sort)) result.sort = search.sort;
  if (isSortDir(search.dir)) result.dir = search.dir;
  const page = Number(search.page);
  if (Number.isInteger(page) && page > 1) result.page = page;
  return result;
}

export type ClaimListItem = Pick<
  AgencyClaim,
  | "claim_number"
  | "claim_type"
  | "line_of_business"
  | "carrier"
  | "adjuster_name"
  | "description"
  | "status"
  | "date_of_loss"
  | "closed_date"
  | "paid_amount"
  | "reserve_amount"
>;

export function filterClaims<T extends ClaimListItem>(
  claims: T[],
  { status, q }: Pick<ClaimsSearch, "status" | "q">,
): T[] {
  const text = q?.trim().toLowerCase() ?? "";
  return claims.filter((c) => {
    if (status && !matchesStatus(c, status)) return false;
    if (!text) return true;
    return [
      c.claim_number,
      c.claim_type,
      c.line_of_business,
      c.carrier,
      c.adjuster_name,
      c.description,
      CLAIM_STATUS_LABELS[c.status],
    ]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(text));
  });
}

// Calendar dates compare as their "YYYY-MM-DD" text; closed_date may carry a time after it.
function dateText(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function text(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function sortValue(claim: ClaimListItem, key: ClaimSortKey): string | number | null {
  switch (key) {
    case "date":
      return dateText(claim.date_of_loss);
    case "closed":
      return dateText(claim.closed_date);
    case "type":
      return text(claim.claim_type);
    case "carrier":
      return text(claim.carrier);
    case "number":
      return text(claim.claim_number);
    case "adjuster":
      return text(claim.adjuster_name);
    case "status":
      return STATUS_BUCKETS.indexOf(statusBucket(claim));
    case "paid":
      return paidAmount(claim);
    case "reserve":
      return reserveAmount(claim);
  }
}

/** A stable sort; missing values always go last, whichever way the column is sorted. */
export function sortClaims<T extends ClaimListItem>(
  claims: T[],
  key: ClaimSortKey,
  dir: SortDir,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return claims
    .map((claim, index) => ({ claim, index, value: sortValue(claim, key) }))
    .sort((a, b) => {
      if (a.value === b.value) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      const cmp =
        typeof a.value === "number" && typeof b.value === "number"
          ? a.value - b.value
          : String(a.value).localeCompare(String(b.value), "en-US", { numeric: true });
      return cmp === 0 ? a.index - b.index : cmp * sign;
    })
    .map((entry) => entry.claim);
}

export interface ClaimsPage<T> {
  rows: T[];
  page: number;
  pageCount: number;
  total: number;
  /** 1-based index of the first row shown, 0 when there are none. */
  from: number;
  to: number;
}

/** One page of rows; a page past the end shows the last page instead. */
export function paginate<T>(rows: T[], page = 1, pageSize = CLAIMS_PAGE_SIZE): ClaimsPage<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  return {
    rows: pageRows,
    page: current,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: start + pageRows.length,
  };
}

/** "26–50 of 80", or "0 of 0" for an empty list. */
export function pageRangeLabel({
  from,
  to,
  total,
}: Pick<ClaimsPage<unknown>, "from" | "to" | "total">): string {
  return total === 0 ? "0 of 0" : `${from}–${to} of ${total}`;
}

/** The search after clicking a column header: same column flips, a new column starts at its default. */
export function nextSort(
  current: { sort: ClaimSortKey; dir: SortDir },
  key: ClaimSortKey,
): { sort: ClaimSortKey; dir: SortDir } {
  if (current.sort === key) return { sort: key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { sort: key, dir: defaultSortDir(key) };
}

// "Open" includes reopened claims, the same as the Open Claims count on Home
// (isOpen in claim-metrics.ts), so /claims?status=open matches that number.
export function matchesStatus(claim: ClaimListItem, status: StatusBucket): boolean {
  if (status === CLAIM_STATUS.open) return isOpen(claim);
  return statusBucket(claim) === status;
}
