import { describe, expect, it } from "vitest";
import { CLAIM_STATUS } from "@/lib/claim-status";
import {
  agencyDateOf,
  businessDaysBetween,
  claimResponseTimes,
  DEFAULT_RESPONSE_TARGETS,
  formatAverageDays,
  inBusinessDays,
  isBusinessDay,
  responseTimesLines,
  staffResponseMetrics,
  type ResponseClaim,
  type StaffMetricsClaim,
} from "@/lib/response-targets";

// November 2026 is EST (UTC-5): Fri 13, Sat 14, Sun 15, Mon 16, Tue 17, Wed 18.
const FRI_4PM = "2026-11-13T21:00:00Z";
const SAT_NOON = "2026-11-14T17:00:00Z";
const SUN_NOON = "2026-11-15T17:00:00Z";
const MON_10AM = "2026-11-16T15:00:00Z";
const MON_3PM = "2026-11-16T20:00:00Z";
const MON_8PM = "2026-11-17T01:00:00Z"; // already Tuesday in UTC
const TUE_9AM = "2026-11-17T14:00:00Z";
const WED_9AM = "2026-11-18T14:00:00Z";
const FRI_20_9AM = "2026-11-20T14:00:00Z";
const MON_23_9AM = "2026-11-23T14:00:00Z";

describe("agencyDateOf", () => {
  it("uses the New York calendar, not UTC", () => {
    expect(agencyDateOf(MON_8PM)).toBe("2026-11-16");
    expect(agencyDateOf(MON_10AM)).toBe("2026-11-16");
  });

  it("follows daylight saving time", () => {
    // 00:30 EDT on Tue 10 March (DST began Sun 8 March); EST would say 9 March.
    expect(agencyDateOf("2026-03-10T04:30:00Z")).toBe("2026-03-10");
    // 23:30 EST on Mon 2 November (DST ended Sun 1 November); EDT would say 3 November.
    expect(agencyDateOf("2026-11-03T04:30:00Z")).toBe("2026-11-02");
  });

  it("is null for nothing or nonsense", () => {
    expect(agencyDateOf(null)).toBeNull();
    expect(agencyDateOf("not a date")).toBeNull();
  });
});

describe("isBusinessDay", () => {
  it("is Monday to Friday", () => {
    expect(isBusinessDay("2026-11-13")).toBe(true);
    expect(isBusinessDay("2026-11-14")).toBe(false);
    expect(isBusinessDay("2026-11-15")).toBe(false);
    expect(isBusinessDay("2026-11-16")).toBe(true);
    expect(isBusinessDay("nope")).toBe(false);
  });
});

describe("businessDaysBetween", () => {
  it("counts the same day as 0, even late in the evening", () => {
    expect(businessDaysBetween(MON_10AM, MON_3PM)).toBe(0);
    expect(businessDaysBetween(MON_10AM, MON_8PM)).toBe(0);
  });

  it("counts the next business day as 1", () => {
    expect(businessDaysBetween(MON_10AM, TUE_9AM)).toBe(1);
    expect(businessDaysBetween(MON_10AM, WED_9AM)).toBe(2);
  });

  it("skips the weekend", () => {
    expect(businessDaysBetween(FRI_4PM, MON_10AM)).toBe(1);
    expect(businessDaysBetween(FRI_4PM, SAT_NOON)).toBe(0);
    expect(businessDaysBetween(FRI_4PM, TUE_9AM)).toBe(2);
  });

  it("starts a weekend arrival's clock on Monday", () => {
    expect(businessDaysBetween(SAT_NOON, MON_10AM)).toBe(0);
    expect(businessDaysBetween(SUN_NOON, TUE_9AM)).toBe(1);
    expect(businessDaysBetween(SAT_NOON, SUN_NOON)).toBe(0);
  });

  it("counts whole weeks as five days", () => {
    expect(businessDaysBetween(MON_10AM, FRI_20_9AM)).toBe(4);
    expect(businessDaysBetween(MON_10AM, MON_23_9AM)).toBe(5);
    expect(businessDaysBetween(MON_10AM, "2026-11-30T14:00:00Z")).toBe(10);
    expect(businessDaysBetween(FRI_4PM, "2026-11-27T14:00:00Z")).toBe(10);
  });

  it("is 0 when the end is before the start", () => {
    expect(businessDaysBetween(TUE_9AM, MON_10AM)).toBe(0);
  });

  it("is null when either end is missing", () => {
    expect(businessDaysBetween(null, MON_10AM)).toBeNull();
    expect(businessDaysBetween(MON_10AM, undefined)).toBeNull();
    expect(businessDaysBetween("bad", MON_10AM)).toBeNull();
  });

  it("dates each end on the New York calendar across DST changes", () => {
    // Fri 6 March 10:00 EST -> Tue 10 March 00:30 EDT: Mon, Tue = 2.
    expect(businessDaysBetween("2026-03-06T15:00:00Z", "2026-03-10T04:30:00Z")).toBe(2);
    // Fri 30 October 17:00 EDT -> Mon 2 November 23:30 EST: Mon = 1.
    expect(businessDaysBetween("2026-10-30T21:00:00Z", "2026-11-03T04:30:00Z")).toBe(1);
  });
});

const claim = (fields: Partial<ResponseClaim> = {}): ResponseClaim => ({
  status: CLAIM_STATUS.submitted,
  created_at: MON_10AM,
  submitted_to_carrier_at: null,
  first_carrier_contact_at: null,
  ...fields,
});

const at = (iso: string) => new Date(iso);

describe("claimResponseTimes", () => {
  const targets = DEFAULT_RESPONSE_TARGETS;

  it("times an unsent claim against the submit target", () => {
    expect(claimResponseTimes(claim(), targets, at(TUE_9AM))).toEqual({
      submitDays: null,
      firstContactDays: null,
      pending: "submit",
      pendingDays: 1,
      pastTarget: false,
    });
    expect(claimResponseTimes(claim(), targets, at(WED_9AM))).toMatchObject({
      pending: "submit",
      pendingDays: 2,
      pastTarget: true,
    });
  });

  it("doesn't count the weekend against the submit target", () => {
    const friday = claim({ created_at: FRI_4PM });
    expect(claimResponseTimes(friday, targets, at(MON_3PM)).pastTarget).toBe(false);
    expect(claimResponseTimes(friday, targets, at(TUE_9AM)).pastTarget).toBe(true);
  });

  it("times a sent claim against the first-contact target", () => {
    const sent = claim({ status: CLAIM_STATUS.open, submitted_to_carrier_at: TUE_9AM });
    expect(claimResponseTimes(sent, targets, at(FRI_20_9AM))).toEqual({
      submitDays: 1,
      firstContactDays: null,
      pending: "first_contact",
      pendingDays: 3,
      pastTarget: false,
    });
    expect(claimResponseTimes(sent, targets, at(MON_23_9AM))).toMatchObject({
      pendingDays: 4,
      pastTarget: true,
    });
  });

  it("reports both durations once both happened", () => {
    const done = claim({
      status: CLAIM_STATUS.open,
      submitted_to_carrier_at: MON_3PM,
      first_carrier_contact_at: WED_9AM,
    });
    expect(claimResponseTimes(done, targets, at(MON_23_9AM))).toEqual({
      submitDays: 0,
      firstContactDays: 2,
      pending: null,
      pendingDays: null,
      pastTarget: false,
    });
  });

  it("doesn't time claims from before the timestamps existed, notices or closed claims", () => {
    const now = at(MON_23_9AM);
    expect(claimResponseTimes(claim({ status: CLAIM_STATUS.open }), targets, now).pending).toBe(
      null,
    );
    expect(claimResponseTimes(claim({ status: CLAIM_STATUS.notice }), targets, now).pending).toBe(
      null,
    );
    const closed = claim({ status: CLAIM_STATUS.closed, submitted_to_carrier_at: MON_3PM });
    expect(claimResponseTimes(closed, targets, now)).toMatchObject({
      pending: null,
      pastTarget: false,
      submitDays: 0,
    });
  });

  it("uses the configured targets", () => {
    const relaxed = { submitTargetDays: 3, firstContactTargetDays: 5 };
    expect(claimResponseTimes(claim(), relaxed, at(FRI_20_9AM)).pastTarget).toBe(true);
    expect(claimResponseTimes(claim(), relaxed, at(WED_9AM)).pastTarget).toBe(false);
  });
});

describe("responseTimesLines", () => {
  const lines = (c: ResponseClaim, now: string) =>
    responseTimesLines(
      c,
      claimResponseTimes(c, DEFAULT_RESPONSE_TARGETS, at(now)),
      DEFAULT_RESPONSE_TARGETS,
    );

  it("describes each state", () => {
    expect(lines(claim(), TUE_9AM)).toEqual(["Not yet submitted (target 1 business day)"]);
    expect(
      lines(claim({ status: CLAIM_STATUS.open, submitted_to_carrier_at: TUE_9AM }), WED_9AM),
    ).toEqual([
      "Submitted to carrier in 1 business day",
      "No carrier contact yet (target 3 business days)",
    ]);
    expect(
      lines(
        claim({
          status: CLAIM_STATUS.open,
          submitted_to_carrier_at: MON_3PM,
          first_carrier_contact_at: WED_9AM,
        }),
        FRI_20_9AM,
      ),
    ).toEqual([
      "Submitted to carrier the same business day",
      "First carrier contact in 2 business days",
    ]);
    expect(lines(claim({ status: CLAIM_STATUS.open }), WED_9AM)).toEqual([
      "Submission to carrier not recorded",
    ]);
    expect(
      lines(claim({ status: CLAIM_STATUS.closed, submitted_to_carrier_at: MON_3PM }), WED_9AM),
    ).toEqual(["Submitted to carrier the same business day", "First carrier contact not recorded"]);
  });

  it("words the counts", () => {
    expect(inBusinessDays(0)).toBe("the same business day");
    expect(inBusinessDays(1)).toBe("in 1 business day");
    expect(inBusinessDays(4)).toBe("in 4 business days");
  });
});

describe("staffResponseMetrics", () => {
  const ANA = "11111111-1111-1111-1111-111111111111";
  const BEN = "22222222-2222-2222-2222-222222222222";
  const row = (fields: Partial<StaffMetricsClaim>): StaffMetricsClaim => ({
    ...claim({ status: CLAIM_STATUS.open }),
    assigned_to: null,
    ...fields,
  });

  it("averages per staff member over the claims that have each duration", () => {
    const metrics = staffResponseMetrics([
      // Ana: submit 0 and 2 -> 1; contact 3 -> 3; one claim not sent yet.
      row({
        assigned_to: ANA,
        submitted_to_carrier_at: MON_3PM,
        first_carrier_contact_at: "2026-11-19T14:00:00Z",
      }),
      row({ assigned_to: ANA, submitted_to_carrier_at: WED_9AM }),
      row({ assigned_to: ANA, status: CLAIM_STATUS.submitted }),
      // Ben: submit 1; contact 1.
      row({
        assigned_to: BEN,
        submitted_to_carrier_at: TUE_9AM,
        first_carrier_contact_at: WED_9AM,
      }),
      // Unassigned: nothing recorded.
      row({}),
    ]);
    expect(metrics).toEqual([
      {
        userId: ANA,
        claimCount: 3,
        avgSubmitDays: 1,
        submittedCount: 2,
        avgFirstContactDays: 3,
        contactedCount: 1,
      },
      {
        userId: BEN,
        claimCount: 1,
        avgSubmitDays: 1,
        submittedCount: 1,
        avgFirstContactDays: 1,
        contactedCount: 1,
      },
      {
        userId: null,
        claimCount: 1,
        avgSubmitDays: null,
        submittedCount: 0,
        avgFirstContactDays: null,
        contactedCount: 0,
      },
    ]);
  });

  it("keeps fractional averages", () => {
    const [m] = staffResponseMetrics([
      row({ assigned_to: ANA, submitted_to_carrier_at: MON_3PM }),
      row({ assigned_to: ANA, submitted_to_carrier_at: TUE_9AM }),
      row({ assigned_to: ANA, submitted_to_carrier_at: TUE_9AM }),
    ]);
    expect(m.avgSubmitDays).toBeCloseTo(2 / 3);
    expect(formatAverageDays(m.avgSubmitDays)).toBe("0.7");
  });

  it("is empty for no claims", () => {
    expect(staffResponseMetrics([])).toEqual([]);
  });

  it("formats averages", () => {
    expect(formatAverageDays(null)).toBe("—");
    expect(formatAverageDays(2)).toBe("2");
    expect(formatAverageDays(1.25)).toBe("1.3");
  });
});
