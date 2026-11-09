// Filtering, sorting and paging for the claims list (fix 24). The list keeps
// all of this in the URL (/claims?status=open&sort=paid&dir=desc&page=2), so
// links such as Home's "Open Claims" card can point straight at a filtered view.
// Fix 31 adds the line, year, carrier and location filters and a search that
// also looks at the claimant, employee, driver, vehicles and loss location.
// The list (and its export) filters the claims fetchAgencyOverview loaded with
// the caller's token, so RLS has already limited them to what the user may see.

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
import { calendarYear } from "@/lib/dates";
import type { AgencyClaim } from "@/lib/overview.types";
import { WAITING_ON_VALUES, claimWaitingOn, lastUpdateAt } from "@/lib/waiting-on";

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
  "waiting",
  "updated",
] as const;

export type ClaimSortKey = (typeof CLAIM_SORT_KEYS)[number];

export const SORT_DIRS = ["asc", "desc"] as const;

export type SortDir = (typeof SORT_DIRS)[number];

export const DEFAULT_CLAIM_SORT: ClaimSortKey = "date";

/**
 * Dates and money read best newest / largest first; text columns A to Z;
 * "Days since update" most days first, so the stalest claims lead.
 */
export function defaultSortDir(key: ClaimSortKey): SortDir {
  return key === "date" ||
    key === "closed" ||
    key === "paid" ||
    key === "reserve" ||
    key === "updated"
    ? "desc"
    : "asc";
}

/** The claims list's URL search params. Every one is optional; missing means the default. */
export interface ClaimsSearch {
  status?: ClaimStatus;
  q?: string;
  /** A line_of_business name, e.g. "Business Auto". */
  line?: string;
  /** The calendar year of date_of_loss. */
  year?: number;
  carrier?: string;
  /**
   * For now the claim's loss_location text. Fix 32 switches this to a real
   * location, so it stays a plain string.
   */
  location?: string;
  sort?: ClaimSortKey;
  dir?: SortDir;
  page?: number;
}

/** The filters beside the search box (status has its own buttons). */
export const CLAIM_FILTER_KEYS = ["line", "year", "carrier", "location"] as const;

export type ClaimFilterKey = (typeof CLAIM_FILTER_KEYS)[number];

export const MAX_SEARCH_LENGTH = 200;
export const MAX_FILTER_LENGTH = 200;
export const MIN_FILTER_YEAR = 1900;
export const MAX_FILTER_YEAR = 2100;

function isSortKey(value: unknown): value is ClaimSortKey {
  return typeof value === "string" && (CLAIM_SORT_KEYS as readonly string[]).includes(value);
}

function isSortDir(value: unknown): value is SortDir {
  return value === "asc" || value === "desc";
}

// A filter value from the URL: trimmed text, or nothing when blank or too long.
function filterText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_FILTER_LENGTH ? trimmed : undefined;
}

// A four-digit year, as a number or as text (the router may hand over either).
function filterYear(value: unknown): number | undefined {
  if (typeof value === "string" && !/^\d{4}$/.test(value.trim())) return undefined;
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const year = Number(value);
  return Number.isInteger(year) && year >= MIN_FILTER_YEAR && year <= MAX_FILTER_YEAR
    ? year
    : undefined;
}

/** validateSearch for /claims: unknown or malformed values are dropped, not errors. */
export function parseClaimsSearch(search: Record<string, unknown>): ClaimsSearch {
  const result: ClaimsSearch = {};
  if (isClaimStatus(search.status)) result.status = search.status;
  if (typeof search.q === "string" && search.q.trim() && search.q.length <= MAX_SEARCH_LENGTH) {
    result.q = search.q;
  }
  const line = filterText(search.line);
  if (line) result.line = line;
  const year = filterYear(search.year);
  if (year) result.year = year;
  const carrier = filterText(search.carrier);
  if (carrier) result.carrier = carrier;
  const location = filterText(search.location);
  if (location) result.location = location;
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
  | "claimant_name"
  | "employee_name"
  | "driver_name"
  | "vehicles_involved"
  | "loss_location"
  | "status"
  | "date_of_loss"
  | "closed_date"
  | "paid_amount"
  | "reserve_amount"
  | "waiting_on"
  | "last_activity_at"
  | "created_at"
>;

/** The search box's words: trimmed, lower-cased, split on any run of whitespace. */
export function searchWords(q: string | undefined): string[] {
  const normalized = q?.trim().toLowerCase() ?? "";
  return normalized ? normalized.split(/\s+/) : [];
}

// Every searchable field of a claim, lower-cased, one per line. Words never
// hold whitespace, so a word can't match across two fields.
function searchText(c: ClaimListItem): string {
  return [
    c.claim_number,
    c.claim_type,
    c.line_of_business,
    c.carrier,
    c.adjuster_name,
    c.claimant_name,
    c.employee_name,
    c.driver_name,
    c.vehicles_involved,
    c.loss_location,
    c.description,
    CLAIM_STATUS_LABELS[c.status],
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase())
    .join("\n");
}

/** Filter values compare trimmed and ignoring case. */
export function filterKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function matchesText(value: string | null | undefined, wanted: string | undefined): boolean {
  return !wanted || filterKey(value) === filterKey(wanted);
}

/**
 * The claims matching the search and filters. Every word of `q` has to appear
 * somewhere in the claim, though each word may match a different field.
 */
export function filterClaims<T extends ClaimListItem>(
  claims: T[],
  { status, q, line, year, carrier, location }: Pick<ClaimsSearch, "status" | "q" | ClaimFilterKey>,
): T[] {
  const words = searchWords(q);
  return claims.filter((c) => {
    if (status && !matchesStatus(c, status)) return false;
    if (!matchesText(c.line_of_business, line)) return false;
    if (year && calendarYear(c.date_of_loss) !== year) return false;
    if (!matchesText(c.carrier, carrier)) return false;
    if (!matchesText(c.loss_location, location)) return false;
    if (words.length === 0) return true;
    const text = searchText(c);
    return words.every((word) => text.includes(word));
  });
}

/** How many of the line, year, carrier and location filters are set. */
export function activeFilterCount(search: Pick<ClaimsSearch, ClaimFilterKey>): number {
  return CLAIM_FILTER_KEYS.filter((key) => search[key] !== undefined).length;
}

export interface ClaimFilterOptions {
  lines: string[];
  /** Newest first. */
  years: number[];
  carriers: string[];
  locations: string[];
}

// Distinct values, ignoring case and outer spaces; the first spelling seen is
// the one shown. Sorted A to Z.
function distinctText(values: (string | null | undefined)[]): string[] {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const key = filterKey(value);
    if (value && key && !byKey.has(key)) byKey.set(key, value.trim());
  }
  return [...byKey.values()].sort((a, b) =>
    a.localeCompare(b, "en-US", { sensitivity: "base", numeric: true }),
  );
}

/** The choices for each filter, taken from the claims the user can see. */
export function claimFilterOptions(claims: ClaimListItem[]): ClaimFilterOptions {
  const years = new Set<number>();
  for (const c of claims) {
    const year = calendarYear(c.date_of_loss);
    if (year) years.add(year);
  }
  return {
    lines: distinctText(claims.map((c) => c.line_of_business)),
    years: [...years].sort((a, b) => b - a),
    carriers: distinctText(claims.map((c) => c.carrier)),
    locations: distinctText(claims.map((c) => c.loss_location)),
  };
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
    case "waiting": {
      // Client, Agency, Carrier order; closed claims (no one) go last.
      const waitingOn = claimWaitingOn(claim);
      return waitingOn ? WAITING_ON_VALUES.indexOf(waitingOn) : null;
    }
    case "updated": {
      // More days since the update = an older time, so sort on the negated
      // time: descending puts the longest-untouched claim first.
      const time = Date.parse(lastUpdateAt(claim) ?? "");
      return Number.isNaN(time) ? null : -time;
    }
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
