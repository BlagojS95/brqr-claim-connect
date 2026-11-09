// Saved views on the claims list (fix 31). A view is a name plus the list's
// search params (everything but the page), stored per user in
// saved_claim_views. These helpers are shared by the page and the server
// functions in saved-views.functions.ts.

import { z } from "zod";
import { CLAIM_STATUSES } from "@/lib/claim-status";
import {
  CLAIM_SORT_KEYS,
  DEFAULT_CLAIM_SORT,
  MAX_FILTER_LENGTH,
  MAX_FILTER_YEAR,
  MAX_SEARCH_LENGTH,
  MIN_FILTER_YEAR,
  SORT_DIRS,
  defaultSortDir,
  parseClaimsSearch,
  searchWords,
  filterKey,
  type ClaimsSearch,
} from "@/lib/claims-list";

export const MAX_VIEW_NAME_LENGTH = 60;

/** The search params a view keeps. The page is left out: a view opens on page 1. */
export const SAVED_VIEW_KEYS = [
  "q",
  "status",
  "line",
  "year",
  "carrier",
  "location",
  "sort",
  "dir",
] as const;

export type SavedViewFilters = Pick<ClaimsSearch, (typeof SAVED_VIEW_KEYS)[number]>;

export interface SavedView {
  id: string;
  name: string;
  filters: SavedViewFilters;
  created_at: string;
}

const filterText = z.string().trim().min(1).max(MAX_FILTER_LENGTH);

/** The shape of saved_claim_views.filters. Unknown keys are refused. */
export const SavedViewFiltersSchema = z
  .object({
    q: z.string().trim().min(1).max(MAX_SEARCH_LENGTH).optional(),
    status: z.enum(CLAIM_STATUSES).optional(),
    line: filterText.optional(),
    year: z.number().int().min(MIN_FILTER_YEAR).max(MAX_FILTER_YEAR).optional(),
    carrier: filterText.optional(),
    location: filterText.optional(),
    sort: z.enum(CLAIM_SORT_KEYS).optional(),
    dir: z.enum(SORT_DIRS).optional(),
  })
  .strict();

export const ViewNameSchema = z
  .string()
  .trim()
  .min(1, "Give the view a name")
  .max(MAX_VIEW_NAME_LENGTH, `Keep the name to ${MAX_VIEW_NAME_LENGTH} characters or fewer`);

/** The view's part of the current search: drops the page and anything unset. */
export function viewFiltersFromSearch(search: ClaimsSearch): SavedViewFilters {
  const filters: SavedViewFilters = {};
  for (const key of SAVED_VIEW_KEYS) {
    const value = search[key];
    if (value !== undefined) (filters as Record<string, unknown>)[key] = value;
  }
  return filters;
}

/**
 * The search a stored view opens. Stored filters are re-checked the same way
 * as the URL, so a bad or outdated value is dropped rather than applied.
 */
export function searchFromViewFilters(filters: unknown): SavedViewFilters {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return {};
  return viewFiltersFromSearch(parseClaimsSearch(filters as Record<string, unknown>));
}

// Two searches show the same list when these match: the words of the search
// (ignoring case and spacing), each filter ignoring case, and the sort with
// its defaults filled in.
function comparable(search: ClaimsSearch): string {
  const f = viewFiltersFromSearch(search);
  const sort = f.sort ?? DEFAULT_CLAIM_SORT;
  return JSON.stringify([
    searchWords(f.q).join(" "),
    f.status ?? "",
    filterKey(f.line),
    f.year ?? "",
    filterKey(f.carrier),
    filterKey(f.location),
    sort,
    f.dir ?? defaultSortDir(sort),
  ]);
}

/** Whether the list in the URL is the one the view shows, so its tab is highlighted. */
export function viewMatchesSearch(filters: SavedViewFilters, search: ClaimsSearch): boolean {
  return comparable(searchFromViewFilters(filters)) === comparable(search);
}

/** The highlighted tab: the first view matching the URL, or null for "All claims" / none. */
export function activeViewId(views: SavedView[], search: ClaimsSearch): string | null {
  return views.find((view) => viewMatchesSearch(view.filters, search))?.id ?? null;
}

/** "All claims" is highlighted when no search or filter is applied (any sort). */
export function isUnfiltered(search: ClaimsSearch): boolean {
  const filters = viewFiltersFromSearch(search);
  return Object.keys(filters).every((key) => key === "sort" || key === "dir");
}
