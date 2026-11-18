import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import type { ClaimsSearch } from "@/lib/claims-list";
import {
  DEFAULT_CLAIMS_COLUMNS,
  DEFAULT_CLAIMS_LIST_PREFS,
  normalizeColumns,
  samePrefs,
  toggleColumn,
  type ClaimsListPrefs,
  type ClaimsTableColumn,
  type TableDensity,
} from "@/lib/claims-table";
import { viewFiltersFromSearch, type SavedViewFilters } from "@/lib/saved-views";
import { fetchClaimsListPrefs, saveClaimsListPrefs } from "@/lib/table-prefs.functions";

export const CLAIMS_PREFS_KEY = ["table-prefs", "claims-list"] as const;
const SAVE_DELAY_MS = 800;

/**
 * The claims list's saved choices (fix 50): visible columns, density and the
 * last filters. They load once; saved filters are applied only when the URL
 * carries none (a shared link or an Insights click still wins). Changes are
 * saved a moment after the last one, and quietly skipped when saving is
 * refused (viewing as a client).
 */
export function useClaimsListPrefs(
  search: ClaimsSearch,
  applyFilters: (filters: SavedViewFilters) => void,
) {
  const { viewingAs } = useAuth();
  const getPrefs = useServerFn(fetchClaimsListPrefs);
  const savePrefs = useServerFn(saveClaimsListPrefs);
  const { data: stored, isSuccess } = useQuery({
    queryKey: CLAIMS_PREFS_KEY,
    queryFn: () => getPrefs(),
    staleTime: Infinity,
  });

  const [columns, setColumns] = useState<ClaimsTableColumn[]>([...DEFAULT_CLAIMS_COLUMNS]);
  const [density, setDensity] = useState<TableDensity>(DEFAULT_CLAIMS_LIST_PREFS.density);
  const ready = useRef(false);
  const lastSaved = useRef<ClaimsListPrefs>(DEFAULT_CLAIMS_LIST_PREFS);
  const filters = viewFiltersFromSearch(search);

  // Adopt the stored choices once.
  useEffect(() => {
    if (!isSuccess || ready.current) return;
    ready.current = true;
    if (!stored) return;
    setColumns(stored.columns);
    setDensity(stored.density);
    lastSaved.current = stored;
    if (Object.keys(filters).length === 0 && Object.keys(stored.filters).length > 0) {
      applyFilters(stored.filters);
    }
    // Runs once, when the stored prefs arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, stored]);

  const current: ClaimsListPrefs = { columns, density, filters };
  const currentKey = JSON.stringify(current);
  useEffect(() => {
    if (!ready.current || viewingAs) return;
    if (samePrefs(current, lastSaved.current)) return;
    const timer = setTimeout(() => {
      lastSaved.current = current;
      savePrefs({ data: current }).catch((err) => console.error("saving table prefs failed", err));
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // currentKey stands for `current`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, viewingAs]);

  return {
    columns: normalizeColumns(columns),
    density,
    setColumn: (column: ClaimsTableColumn, visible: boolean) =>
      setColumns((prev) => toggleColumn(prev, column, visible)),
    resetColumns: () => setColumns([...DEFAULT_CLAIMS_COLUMNS]),
    setDensity,
  };
}
