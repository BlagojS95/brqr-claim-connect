import { describe, expect, it } from "vitest";
import { LINE_OF_BUSINESS_NAMES } from "@/lib/line-of-business";
import {
  LOSS_RUN_REQUEST_LINES,
  formatRequestLines,
  formatRequestYears,
  normalizeRequestLines,
  sortRequestYears,
} from "@/lib/loss-run-request";

describe("loss run request years", () => {
  it("sorts oldest first and drops duplicates", () => {
    expect(sortRequestYears([2026, 2024, 2025, 2023, 2022, 2024])).toEqual([
      2022, 2023, 2024, 2025, 2026,
    ]);
  });

  it("handles a missing list", () => {
    expect(sortRequestYears(null)).toEqual([]);
    expect(formatRequestYears(undefined)).toBe("");
  });

  it("does not change the list it was given", () => {
    const years = [2026, 2022];
    sortRequestYears(years);
    expect(years).toEqual([2026, 2022]);
  });

  it("formats for display", () => {
    expect(formatRequestYears([2026, 2024, 2025])).toBe("2024, 2025, 2026");
  });
});

describe("loss run request lines", () => {
  it("offers only lookup-table names", () => {
    const names: string[] = Object.values(LINE_OF_BUSINESS_NAMES);
    for (const line of LOSS_RUN_REQUEST_LINES) expect(names).toContain(line);
    expect(LOSS_RUN_REQUEST_LINES).toContain("Commercial Property");
    expect(LOSS_RUN_REQUEST_LINES).not.toContain("Other");
  });

  it("maps old hand-typed names onto the lookup names", () => {
    expect(normalizeRequestLines(["Property", "Commercial Auto"])).toEqual([
      "Business Auto",
      "Commercial Property",
    ]);
  });

  it("accepts codes and any-case names", () => {
    expect(normalizeRequestLines(["PROP", "general liability", " Cyber "])).toEqual([
      "General Liability",
      "Commercial Property",
      "Cyber",
    ]);
  });

  it("drops duplicates and blanks, keeping unknown lines at the end", () => {
    expect(
      normalizeRequestLines(["Property", "Commercial Property", "", "Marine", "Marine"]),
    ).toEqual(["Commercial Property", "Marine"]);
  });

  it("formats for display", () => {
    expect(formatRequestLines(["Property", "General Liability"])).toBe(
      "General Liability, Commercial Property",
    );
    expect(formatRequestLines(null)).toBe("");
  });
});
