import { describe, expect, it } from "vitest";
import { calendarYear, formatDate, parseCalendarDate, todayIso } from "@/lib/dates";

// Run under TZ=America/New_York and TZ=America/Los_Angeles as well as the default.
describe("calendar dates", () => {
  it("shows the stored day, not the day before", () => {
    expect(formatDate("2026-09-09")).toBe("9/9/2026");
  });

  it("reads closed_date timestamps stored at midnight UTC as the same day", () => {
    expect(formatDate("2026-09-09T00:00:00+00:00")).toBe("9/9/2026");
  });

  it("keeps new year's day in its own year", () => {
    expect(calendarYear("2026-01-01")).toBe(2026);
    expect(formatDate("2026-01-01")).toBe("1/1/2026");
  });

  it("handles missing and invalid values", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined, "n/a")).toBe("n/a");
    expect(formatDate("not a date")).toBe("—");
    expect(parseCalendarDate("")).toBeNull();
    expect(calendarYear(null)).toBeNull();
  });

  it("uses the agency's calendar for today", () => {
    // 02:00 UTC on Sep 10 is still the evening of Sep 9 in New York.
    expect(todayIso(new Date("2026-09-10T02:00:00Z"))).toBe("2026-09-09");
  });
});
