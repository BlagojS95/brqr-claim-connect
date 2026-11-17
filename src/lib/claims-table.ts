// Table controls on the claims list (fix 50): which columns the desktop table
// shows, the row density, and the filters the user last had. All three are
// saved per user in user_table_prefs.claims_list (see table-prefs.functions.ts)
// and parsed here, so a bad or outdated stored value falls back to the default
// rather than breaking the page.

import { z } from "zod";
import { CLAIM_SORT_KEYS, type ClaimSortKey } from "@/lib/claims-list";
import {
  SavedViewFiltersSchema,
  searchFromViewFilters,
  type SavedViewFilters,
} from "@/lib/saved-views";

/** The desktop table's columns, in display order; each one sorts by its own key. */
export const CLAIMS_TABLE_COLUMNS = CLAIM_SORT_KEYS;
export type ClaimsTableColumn = ClaimSortKey;

/**
 * Date of loss always shows: its cell is the row's one stop in the tab order
 * and carries the row's accessible name.
 */
export const REQUIRED_CLAIMS_COLUMNS: readonly ClaimsTableColumn[] = ["date"];

export const DEFAULT_CLAIMS_COLUMNS: readonly ClaimsTableColumn[] = CLAIMS_TABLE_COLUMNS;

export const TABLE_DENSITIES = ["comfortable", "compact"] as const;
export type TableDensity = (typeof TABLE_DENSITIES)[number];
export const DEFAULT_TABLE_DENSITY: TableDensity = "comfortable";
export const TABLE_DENSITY_LABELS: Record<TableDensity, string> = {
  comfortable: "Comfortable",
  compact: "Compact",
};

export interface ClaimsListPrefs {
  /** Visible desktop columns, in table order. */
  columns: ClaimsTableColumn[];
  density: TableDensity;
  /** The list's last search and filters (the same shape as a saved view). */
  filters: SavedViewFilters;
}

export const DEFAULT_CLAIMS_LIST_PREFS: ClaimsListPrefs = {
  columns: [...DEFAULT_CLAIMS_COLUMNS],
  density: DEFAULT_TABLE_DENSITY,
  filters: {},
};

function isColumn(value: unknown): value is ClaimsTableColumn {
  return typeof value === "string" && (CLAIMS_TABLE_COLUMNS as readonly string[]).includes(value);
}

/** Keeps known columns, in table order, always with the required ones. */
export function normalizeColumns(columns: readonly unknown[]): ClaimsTableColumn[] {
  const wanted = new Set<ClaimsTableColumn>(REQUIRED_CLAIMS_COLUMNS);
  for (const c of columns) if (isColumn(c)) wanted.add(c);
  return CLAIMS_TABLE_COLUMNS.filter((c) => wanted.has(c));
}

/** Shows or hides one column; a required column stays. */
export function toggleColumn(
  columns: readonly ClaimsTableColumn[],
  column: ClaimsTableColumn,
  visible: boolean,
): ClaimsTableColumn[] {
  const next = visible ? [...columns, column] : columns.filter((c) => c !== column);
  return normalizeColumns(next);
}

/** Reads stored prefs; anything missing or invalid takes its default. */
export function parseClaimsListPrefs(value: unknown): ClaimsListPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_CLAIMS_LIST_PREFS, columns: [...DEFAULT_CLAIMS_COLUMNS] };
  }
  const raw = value as Record<string, unknown>;
  const columns = Array.isArray(raw.columns)
    ? normalizeColumns(raw.columns)
    : [...DEFAULT_CLAIMS_COLUMNS];
  const density = (TABLE_DENSITIES as readonly unknown[]).includes(raw.density)
    ? (raw.density as TableDensity)
    : DEFAULT_TABLE_DENSITY;
  return { columns, density, filters: searchFromViewFilters(raw.filters) };
}

/** What the browser may send to be saved. Unknown keys are refused. */
export const ClaimsListPrefsSchema = z
  .object({
    columns: z.array(z.enum(CLAIMS_TABLE_COLUMNS)).max(CLAIMS_TABLE_COLUMNS.length),
    density: z.enum(TABLE_DENSITIES),
    filters: SavedViewFiltersSchema,
  })
  .strict();

/** True when two prefs would save the same row; avoids needless writes. */
export function samePrefs(a: ClaimsListPrefs, b: ClaimsListPrefs): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(p: ClaimsListPrefs) {
  const filters = Object.fromEntries(
    Object.entries(p.filters)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return [normalizeColumns(p.columns), p.density, filters];
}

/** Row and card padding for each density (phones keep cards; density applies to both). */
export const DENSITY_CLASSES: Record<
  TableDensity,
  { cell: string; card: string; cardGap: string }
> = {
  comfortable: { cell: "p-3", card: "p-4", cardGap: "space-y-3" },
  compact: { cell: "px-3 py-1.5", card: "p-3", cardGap: "space-y-2" },
};

// ---- Row selection (bulk Export and Watch) ----

/** The most claims one bulk action takes, so a request stays small. */
export const MAX_BULK_CLAIMS = 500;

/** Adds or removes ids; returns a new set. */
export function setSelected(
  selected: ReadonlySet<string>,
  ids: readonly string[],
  on: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** The header checkbox: all rows on the page picked, some, or none. */
export function pageSelectionState(
  selected: ReadonlySet<string>,
  pageIds: readonly string[],
): boolean | "indeterminate" {
  if (pageIds.length === 0) return false;
  const picked = pageIds.filter((id) => selected.has(id)).length;
  if (picked === 0) return false;
  return picked === pageIds.length ? true : "indeterminate";
}

/** The selected claims among `claims`, in that order (e.g. the list's sort). */
export function selectedClaims<T extends { id: string }>(
  claims: readonly T[],
  selected: ReadonlySet<string>,
): T[] {
  return claims.filter((c) => selected.has(c.id));
}
