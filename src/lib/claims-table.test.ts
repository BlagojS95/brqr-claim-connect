import { describe, expect, it } from "vitest";
import {
  CLAIMS_TABLE_COLUMNS,
  ClaimsListPrefsSchema,
  DEFAULT_CLAIMS_LIST_PREFS,
  normalizeColumns,
  pageSelectionState,
  parseClaimsListPrefs,
  samePrefs,
  selectedClaims,
  setSelected,
  toggleColumn,
} from "@/lib/claims-table";

describe("columns", () => {
  it("keeps the required date column and table order", () => {
    expect(normalizeColumns(["paid", "bogus", "type"])).toEqual(["date", "type", "paid"]);
  });
  it("cannot hide the date column", () => {
    expect(toggleColumn(CLAIMS_TABLE_COLUMNS, "date", false)).toContain("date");
    expect(toggleColumn(CLAIMS_TABLE_COLUMNS, "paid", false)).not.toContain("paid");
  });
});

describe("parseClaimsListPrefs", () => {
  it("falls back to defaults for junk", () => {
    expect(parseClaimsListPrefs(null)).toEqual(DEFAULT_CLAIMS_LIST_PREFS);
    expect(parseClaimsListPrefs([])).toEqual(DEFAULT_CLAIMS_LIST_PREFS);
    expect(parseClaimsListPrefs({ density: "huge", columns: "x" })).toEqual(
      DEFAULT_CLAIMS_LIST_PREFS,
    );
  });
  it("reads valid prefs and drops bad filters", () => {
    const p = parseClaimsListPrefs({
      columns: ["status", "nope"],
      density: "compact",
      filters: { status: "open", year: "not a year", evil: 1 },
    });
    expect(p.columns).toEqual(["date", "status"]);
    expect(p.density).toBe("compact");
    expect(p.filters.status).toBe("open");
    expect(p.filters).not.toHaveProperty("evil");
  });
  it("the save schema refuses unknown keys", () => {
    expect(
      ClaimsListPrefsSchema.safeParse({ columns: ["date"], density: "compact", filters: {}, x: 1 })
        .success,
    ).toBe(false);
    expect(
      ClaimsListPrefsSchema.safeParse({ columns: ["date"], density: "compact", filters: {} })
        .success,
    ).toBe(true);
  });
  it("samePrefs ignores column order and undefined filters", () => {
    const a = { ...DEFAULT_CLAIMS_LIST_PREFS, columns: ["paid" as const, "date" as const] };
    const b = { ...DEFAULT_CLAIMS_LIST_PREFS, columns: ["date" as const, "paid" as const] };
    expect(samePrefs(a, b)).toBe(true);
    expect(samePrefs(a, { ...b, density: "compact" })).toBe(false);
  });
});

describe("selection", () => {
  it("adds, removes and reports the page state", () => {
    let sel: ReadonlySet<string> = new Set();
    expect(pageSelectionState(sel, ["a", "b"])).toBe(false);
    sel = setSelected(sel, ["a"], true);
    expect(pageSelectionState(sel, ["a", "b"])).toBe("indeterminate");
    sel = setSelected(sel, ["b"], true);
    expect(pageSelectionState(sel, ["a", "b"])).toBe(true);
    sel = setSelected(sel, ["a", "b"], false);
    expect(sel.size).toBe(0);
    expect(pageSelectionState(sel, [])).toBe(false);
  });
  it("keeps the list's order", () => {
    const claims = [{ id: "1" }, { id: "2" }, { id: "3" }];
    expect(selectedClaims(claims, new Set(["3", "1"]))).toEqual([{ id: "1" }, { id: "3" }]);
  });
});
