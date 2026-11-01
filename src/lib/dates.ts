// date_of_loss, date_reported, closed_date and policy dates are calendar dates.
// new Date("YYYY-MM-DD") reads them as UTC midnight, which is the previous day
// anywhere in the US, so everything here works on the date text instead.
// closed_date is a timestamptz column but always holds midnight UTC, so its
// leading date part is the calendar date too.

const AGENCY_TIME_ZONE = "America/New_York";

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export function parseCalendarDate(value: string | null | undefined): CalendarDate | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** "2026-09-09" -> "9/9/2026". Never shows a time. */
export function formatDate(value: string | null | undefined, empty = "—"): string {
  const date = parseCalendarDate(value);
  return date ? `${date.month}/${date.day}/${date.year}` : empty;
}

export function calendarYear(value: string | null | undefined): number | null {
  return parseCalendarDate(value)?.year ?? null;
}

/** Today as "YYYY-MM-DD" on the agency's calendar, the same on server and browser. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: AGENCY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
