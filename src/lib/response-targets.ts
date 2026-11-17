// Response targets (fix 56): how fast the agency sends a new claim to the
// carrier, and how fast the carrier first gets back, in business days.
//
// Business days are Monday to Friday on the agency's calendar
// (America/New_York, via todayIso in dates.ts, so DST is handled by Intl).
// There is no holiday list: a claim reported before a public holiday gets one
// day less than it should. Add one here if that ever matters.
//
// Counting: the clock starts on the business day the claim arrived (a claim
// that arrives on a Saturday or Sunday starts on the Monday), and every
// business day after that, up to and including the day it ended, counts as
// one. So Monday to Monday is 0 ("the same business day"), Monday to Tuesday
// is 1, and Friday to Monday is 1.
//
// Pure functions only; the server loads the rows and the targets
// (response-targets.functions.ts).

import { parseCalendarDate, todayIso } from "@/lib/dates";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";

export interface ResponseTargets {
  /** created_at -> submitted_to_carrier_at. */
  submitTargetDays: number;
  /** submitted_to_carrier_at -> first_carrier_contact_at. */
  firstContactTargetDays: number;
}

/** The agency_settings column defaults. */
export const DEFAULT_RESPONSE_TARGETS: ResponseTargets = {
  submitTargetDays: 1,
  firstContactTargetDays: 3,
};

/** The agency_settings CHECK constraint range. */
export const RESPONSE_TARGET_MIN_DAYS = 1;
export const RESPONSE_TARGET_MAX_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

// A calendar date as a day number (days since 1970-01-01) so stepping and
// weekday checks need no time zone. Built from the date's parts, never by
// parsing "YYYY-MM-DD" as a Date.
function dayNumber(isoDate: string): number | null {
  const d = parseCalendarDate(isoDate);
  if (!d) return null;
  return Date.UTC(d.year, d.month - 1, d.day) / DAY_MS;
}

// 1970-01-01 was a Thursday; 0 = Sunday ... 6 = Saturday.
function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

function isWeekday(day: number): boolean {
  const w = weekday(day);
  return w !== 0 && w !== 6;
}

/** The agency-calendar date ("YYYY-MM-DD") of a timestamp, or null. */
export function agencyDateOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return todayIso(new Date(time));
}

/** True for Monday to Friday. Takes a calendar date ("YYYY-MM-DD"). */
export function isBusinessDay(isoDate: string): boolean {
  const day = dayNumber(isoDate);
  return day !== null && isWeekday(day);
}

/**
 * Whole business days from `startIso` to `endIso` (timestamps), counted as
 * described at the top of this file. Null when either is missing or invalid;
 * 0 when the end is before the start.
 */
export function businessDaysBetween(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): number | null {
  const startDate = agencyDateOf(startIso);
  const endDate = agencyDateOf(endIso);
  if (!startDate || !endDate) return null;
  let start = dayNumber(startDate)!;
  const end = dayNumber(endDate)!;
  // A weekend arrival starts the clock on Monday.
  while (!isWeekday(start)) start++;
  if (end <= start) return 0;

  // Whole weeks hold 5 business days each; walk the remaining few days.
  const span = end - start;
  let count = Math.floor(span / 7) * 5;
  for (let day = start + Math.floor(span / 7) * 7 + 1; day <= end; day++) {
    if (isWeekday(day)) count++;
  }
  return count;
}

export interface ResponseClaim {
  status: ClaimStatus;
  created_at: string;
  submitted_to_carrier_at: string | null;
  first_carrier_contact_at: string | null;
}

/** What the agency is still waiting to happen on a claim, if anything. */
export type PendingResponse = "submit" | "first_contact";

export interface ResponseTimes {
  /** Business days from created to submitted, once submitted. */
  submitDays: number | null;
  /** Business days from submitted to first carrier contact, once contacted. */
  firstContactDays: number | null;
  /** The step still open and timed against its target, or null. */
  pending: PendingResponse | null;
  /** Business days the pending step has been open so far. */
  pendingDays: number | null;
  /** The pending step has run past its target. */
  pastTarget: boolean;
}

/**
 * Durations and the target check for one claim.
 *
 * Only these count as pending, so claims from before these timestamps existed
 * don't all show up as late:
 * - "submit": status is still Submitted (the client reported it, the carrier
 *   hasn't got it) and no submitted_to_carrier_at. Notices aren't timed.
 * - "first_contact": submitted_to_carrier_at is set, no first contact yet, and
 *   the claim isn't closed.
 * A step is past target once more business days than the target have gone by,
 * so with a 1-day target a claim reported Monday is late on Wednesday.
 */
export function claimResponseTimes(
  claim: ResponseClaim,
  targets: ResponseTargets,
  now: Date,
): ResponseTimes {
  const nowIso = now.toISOString();
  const submitted = claim.submitted_to_carrier_at;
  const contacted = claim.first_carrier_contact_at;
  const submitDays = submitted ? businessDaysBetween(claim.created_at, submitted) : null;
  const firstContactDays =
    submitted && contacted ? businessDaysBetween(submitted, contacted) : null;

  let pending: PendingResponse | null = null;
  let pendingDays: number | null = null;
  let target = 0;
  if (!submitted && claim.status === CLAIM_STATUS.submitted) {
    pending = "submit";
    pendingDays = businessDaysBetween(claim.created_at, nowIso);
    target = targets.submitTargetDays;
  } else if (submitted && !contacted && claim.status !== CLAIM_STATUS.closed) {
    pending = "first_contact";
    pendingDays = businessDaysBetween(submitted, nowIso);
    target = targets.firstContactTargetDays;
  }

  return {
    submitDays,
    firstContactDays,
    pending,
    pendingDays,
    pastTarget: pending !== null && pendingDays !== null && pendingDays > target,
  };
}

function businessDays(n: number): string {
  return `${n} business day${n === 1 ? "" : "s"}`;
}

/** "the same business day", "in 1 business day", "in 3 business days". */
export function inBusinessDays(n: number): string {
  return n === 0 ? "the same business day" : `in ${businessDays(n)}`;
}

/**
 * The lines claim detail shows staff, e.g. ["Submitted to carrier in 1
 * business day", "First carrier contact in 2 business days"] or ["Not yet
 * submitted (target 1 business day)"].
 */
export function responseTimesLines(
  claim: ResponseClaim,
  times: ResponseTimes,
  targets: ResponseTargets,
): string[] {
  const lines: string[] = [];
  if (times.submitDays !== null) {
    lines.push(`Submitted to carrier ${inBusinessDays(times.submitDays)}`);
  } else if (times.pending === "submit") {
    lines.push(`Not yet submitted (target ${businessDays(targets.submitTargetDays)})`);
  } else {
    lines.push("Submission to carrier not recorded");
  }

  if (times.firstContactDays !== null) {
    lines.push(`First carrier contact ${inBusinessDays(times.firstContactDays)}`);
  } else if (times.pending === "first_contact") {
    lines.push(`No carrier contact yet (target ${businessDays(targets.firstContactTargetDays)})`);
  } else if (claim.submitted_to_carrier_at) {
    lines.push("First carrier contact not recorded");
  }
  return lines;
}

// --- Staff metrics --------------------------------------------------------------

/** How far back the staff metrics look, by claim created_at. */
export const STAFF_METRICS_WINDOW_DAYS = 90;

export interface StaffMetricsClaim extends ResponseClaim {
  assigned_to: string | null;
}

export interface StaffResponseMetrics {
  /** Null for claims nobody is assigned to. */
  userId: string | null;
  /** Claims created in the window. */
  claimCount: number;
  /** Mean business days to submit, over the claims submitted; null if none. */
  avgSubmitDays: number | null;
  submittedCount: number;
  /** Mean business days to first contact, over the claims contacted; null if none. */
  avgFirstContactDays: number | null;
  contactedCount: number;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Per assigned staff member (and one row for unassigned claims): average
 * business days to submit and to first contact over the claims given, which
 * the caller limits to the window. Claims without a duration don't pull the
 * average down; they only count towards claimCount. Sorted by claim count,
 * most first, with Unassigned last.
 */
export function staffResponseMetrics(claims: readonly StaffMetricsClaim[]): StaffResponseMetrics[] {
  const groups = new Map<string | null, { count: number; submit: number[]; contact: number[] }>();
  for (const claim of claims) {
    const key = claim.assigned_to ?? null;
    let group = groups.get(key);
    if (!group) {
      group = { count: 0, submit: [], contact: [] };
      groups.set(key, group);
    }
    group.count++;
    if (claim.submitted_to_carrier_at) {
      const days = businessDaysBetween(claim.created_at, claim.submitted_to_carrier_at);
      if (days !== null) group.submit.push(days);
      if (claim.first_carrier_contact_at) {
        const contact = businessDaysBetween(
          claim.submitted_to_carrier_at,
          claim.first_carrier_contact_at,
        );
        if (contact !== null) group.contact.push(contact);
      }
    }
  }
  return [...groups]
    .map(([userId, g]) => ({
      userId,
      claimCount: g.count,
      avgSubmitDays: mean(g.submit),
      submittedCount: g.submit.length,
      avgFirstContactDays: mean(g.contact),
      contactedCount: g.contact.length,
    }))
    .sort(
      (a, b) =>
        Number(a.userId === null) - Number(b.userId === null) || b.claimCount - a.claimCount,
    );
}

/** "1.5", "2", or "—". One decimal at most. */
export function formatAverageDays(value: number | null): string {
  if (value === null) return "—";
  return String(Math.round(value * 10) / 10);
}
