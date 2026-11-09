import { describe, expect, it } from "vitest";
import { CLAIM_STATUS } from "@/lib/claim-status";
import {
  SavedViewFiltersSchema,
  ViewNameSchema,
  activeViewId,
  isUnfiltered,
  searchFromViewFilters,
  viewFiltersFromSearch,
  viewMatchesSearch,
  type SavedView,
} from "@/lib/saved-views";

const view = (id: string, filters: SavedView["filters"]): SavedView => ({
  id,
  name: id,
  filters,
  created_at: "2026-11-10T00:00:00Z",
});

describe("viewFiltersFromSearch", () => {
  it("keeps the search, filters and sort but not the page", () => {
    expect(
      viewFiltersFromSearch({
        q: "smith",
        status: CLAIM_STATUS.open,
        line: "Business Auto",
        year: 2026,
        carrier: "Progressive",
        location: "HQ",
        sort: "paid",
        dir: "desc",
        page: 3,
      }),
    ).toEqual({
      q: "smith",
      status: "open",
      line: "Business Auto",
      year: 2026,
      carrier: "Progressive",
      location: "HQ",
      sort: "paid",
      dir: "desc",
    });
  });

  it("leaves out unset values", () => {
    expect(viewFiltersFromSearch({ status: undefined, q: "x" })).toEqual({ q: "x" });
  });
});

describe("searchFromViewFilters", () => {
  it("re-validates stored filters and drops bad values", () => {
    expect(
      searchFromViewFilters({
        status: "Open",
        year: "1066",
        carrier: " Chubb ",
        sort: "hack",
        page: 4,
        extra: true,
      }),
    ).toEqual({ carrier: "Chubb" });
  });

  it("handles a non-object", () => {
    expect(searchFromViewFilters(null)).toEqual({});
    expect(searchFromViewFilters("status=open")).toEqual({});
    expect(searchFromViewFilters([1])).toEqual({});
  });

  it("round-trips a search", () => {
    const filters = { q: "unit 42", line: "Business Auto", year: 2025, dir: "asc" as const };
    expect(searchFromViewFilters(viewFiltersFromSearch(filters))).toEqual(filters);
  });
});

describe("viewMatchesSearch", () => {
  it("matches the same search ignoring page, case and spacing", () => {
    expect(
      viewMatchesSearch(
        { q: "John Smith", carrier: "Progressive", status: "open" },
        { q: "  john   smith ", carrier: "PROGRESSIVE", status: "open", page: 2 },
      ),
    ).toBe(true);
  });

  it("fills in the default sort", () => {
    expect(
      viewMatchesSearch({ status: "open" }, { status: "open", sort: "date", dir: "desc" }),
    ).toBe(true);
    expect(viewMatchesSearch({ sort: "paid" }, { sort: "paid", dir: "desc" })).toBe(true);
    expect(viewMatchesSearch({ sort: "paid" }, { sort: "paid", dir: "asc" })).toBe(false);
  });

  it("does not match when any filter differs or is extra", () => {
    expect(viewMatchesSearch({ year: 2025 }, { year: 2026 })).toBe(false);
    expect(viewMatchesSearch({ year: 2025 }, { year: 2025, location: "HQ" })).toBe(false);
    expect(viewMatchesSearch({ line: "Cyber" }, {})).toBe(false);
  });
});

describe("activeViewId and isUnfiltered", () => {
  const views = [view("auto", { line: "Business Auto" }), view("open", { status: "open" })];

  it("finds the view matching the URL", () => {
    expect(activeViewId(views, { status: "open" })).toBe("open");
    expect(activeViewId(views, { line: "business auto", page: 2 })).toBe("auto");
    expect(activeViewId(views, { status: "closed" })).toBeNull();
  });

  it("treats a search with only a sort as unfiltered", () => {
    expect(isUnfiltered({})).toBe(true);
    expect(isUnfiltered({ sort: "paid", dir: "asc", page: 3 })).toBe(true);
    expect(isUnfiltered({ q: "x" })).toBe(false);
    expect(isUnfiltered({ year: 2026 })).toBe(false);
  });
});

describe("SavedViewFiltersSchema", () => {
  it("accepts the list's search params", () => {
    expect(
      SavedViewFiltersSchema.safeParse({ q: "smith", status: "open", year: 2026, sort: "paid" })
        .success,
    ).toBe(true);
    expect(SavedViewFiltersSchema.safeParse({}).success).toBe(true);
  });

  it("refuses unknown keys and bad values", () => {
    for (const filters of [
      { page: 2 },
      { status: "Open" },
      { year: "2026" },
      { year: 1800 },
      { sort: "hack" },
      { dir: "up" },
      { carrier: "" },
      { q: "x".repeat(201) },
      { admin: true },
    ]) {
      expect(SavedViewFiltersSchema.safeParse(filters).success).toBe(false);
    }
    expect(SavedViewFiltersSchema.safeParse([]).success).toBe(false);
  });
});

describe("ViewNameSchema", () => {
  it("trims and allows 1 to 60 characters", () => {
    expect(ViewNameSchema.parse("  Open auto  ")).toBe("Open auto");
    expect(ViewNameSchema.safeParse("x".repeat(60)).success).toBe(true);
  });

  it("refuses blank or too long names", () => {
    expect(ViewNameSchema.safeParse("   ").success).toBe(false);
    expect(ViewNameSchema.safeParse("x".repeat(61)).success).toBe(false);
  });
});
