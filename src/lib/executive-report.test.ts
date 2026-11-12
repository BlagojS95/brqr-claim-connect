import { describe, expect, it } from "vitest";
import { claimTotals } from "@/lib/claim-metrics";
import { CLAIM_STATUS } from "@/lib/claim-status";
import {
  buildExecutiveReport,
  earnedPremium,
  type ExecutiveReportInput,
  type ReportClaim,
  type ReportPolicy,
} from "@/lib/executive-report";
import { renderExecutiveReportPdf } from "@/lib/exports/executive-report-pdf";
import { breakdownBy } from "@/lib/insights-breakdowns";
import { claimsInRange, priorRange, resolvePeriod } from "@/lib/insights-period";
import { resolveComparison, resolveReportPeriod } from "@/lib/report-periods";

const LINES = [
  { id: "gl", name: "General Liability", code: "GL" },
  { id: "wc", name: "Workers Compensation", code: "WC" },
];

let n = 0;
const claim = (fields: Partial<ReportClaim> = {}): ReportClaim => ({
  id: `c${++n}`,
  claim_number: `CL-${n}`,
  claim_type: "Slip and fall",
  status: CLAIM_STATUS.open,
  line_of_business: "General Liability",
  carrier: "Chubb",
  date_of_loss: "2026-03-01",
  date_reported: "2026-03-02",
  created_at: "2026-03-02T10:00:00Z",
  paid_amount: 1000,
  reserve_amount: 500,
  recovery_amount: null,
  cause_of_loss: "Fall",
  policy_number: "GL-1",
  loss_location: null,
  location_name: "Yard",
  is_litigated: false,
  wc_claim_kind: null,
  ...fields,
});

const policy = (fields: Partial<ReportPolicy> = {}): ReportPolicy => ({
  policy_number: "GL-1",
  policy_type: null,
  line_of_business_id: "gl",
  effective_date: "2026-01-01",
  expiry_date: "2027-01-01",
  premium: 36_500,
  experience_mod: null,
  ...fields,
});

const TODAY = "2026-11-12";
const CLAIMS: ReportClaim[] = [
  claim({ paid_amount: 30_000, reserve_amount: 5_000, is_litigated: true, recovery_amount: 2_000 }),
  claim({
    status: CLAIM_STATUS.closed,
    date_of_loss: "2026-06-10",
    paid_amount: 400,
    reserve_amount: 0,
  }),
  claim({
    line_of_business: "Workers Compensation",
    wc_claim_kind: "lost_time",
    date_of_loss: "2026-02-01",
    date_reported: "2025-10-01",
  }),
  claim({ line_of_business: "Workers Compensation", wc_claim_kind: "medical_only" }),
  claim({ date_of_loss: "2025-04-01", paid_amount: 50, reserve_amount: 0 }),
  claim({ date_of_loss: null, status: CLAIM_STATUS.reopened, date_reported: "2024-01-01" }),
];

const input = (overrides: Partial<ExecutiveReportInput> = {}): ExecutiveReportInput => {
  const period = resolvePeriod({ period: "ytd", today: TODAY })!;
  return {
    clientName: "TEST Co",
    period,
    comparison: priorRange(period),
    threshold: 25_000,
    brokerNotes: "  Renewal looks good.  ",
    today: TODAY,
    claims: CLAIMS,
    policies: [
      policy(),
      policy({
        policy_number: "WC-1",
        line_of_business_id: "wc",
        premium: 10_000,
        experience_mod: 0.92,
      }),
    ],
    lines: LINES,
    reserveChanges: [],
    reserveHistorySince: null,
    ...overrides,
  };
};

describe("buildExecutiveReport headline", () => {
  it("equals the Insights figures for the same period and comparison", () => {
    const report = buildExecutiveReport(input());
    const period = resolvePeriod({ period: "ytd", today: TODAY })!;
    // What the Insights page computes for ?period=ytd (claimsInRange + claimTotals).
    expect(report.headline.current).toEqual(claimTotals(claimsInRange(CLAIMS, period)));
    expect(report.headline.comparison).toEqual(
      claimTotals(claimsInRange(CLAIMS, priorRange(period))),
    );
    expect(report.headline.current.claims).toBe(4);
    // And the Insights breakdowns add up to the same totals.
    const byLine = breakdownBy(claimsInRange(CLAIMS, period), "line");
    expect(byLine.reduce((s, r) => s + r.incurred, 0)).toBe(report.headline.current.incurred);
    expect(report.lossRatio.total.incurred).toBe(report.headline.current.incurred);
  });

  it("works out the change against the comparison", () => {
    const report = buildExecutiveReport(input());
    expect(report.headline.comparison.claims).toBe(1);
    expect(report.headline.change.claims).toBe(300);
  });
});

describe("sections", () => {
  const report = buildExecutiveReport(input());

  it("lists large losses at or over the threshold, biggest first", () => {
    expect(report.largeLosses.map((r) => r.incurred)).toEqual([35_000]);
    // 35,000, 1,500 and 1,500 reach $1,000; the 400 claim doesn't.
    expect(buildExecutiveReport(input({ threshold: 1_000 })).largeLosses).toHaveLength(3);
  });

  it("ages every claim open today from its reported date", () => {
    // Every open or reopened claim, including the 2025 loss outside the period.
    expect(report.aging.open).toBe(5);
    expect(report.aging.buckets.map((b) => b.count)).toEqual([0, 0, 3, 2]);
    expect(report.aging.oldest[0].ageDays).toBe(1046);
  });

  it("counts workers comp lost time and medical only, with the experience mod", () => {
    expect(report.workersComp.claims).toBe(2);
    expect(report.workersComp.lostTime.count).toBe(1);
    expect(report.workersComp.medicalOnly.count).toBe(1);
    expect(report.workersComp.notRecorded.count).toBe(0);
    expect(report.workersComp.experienceMods).toEqual([
      { policyNumber: "WC-1", mod: 0.92, term: "2026-01-01 – 2027-01-01" },
    ]);
  });

  it("totals litigated claims, recoveries and net incurred", () => {
    expect(report.litigation.count).toBe(1);
    expect(report.litigation.incurred).toBe(35_000);
    expect(report.recoveries.total).toBe(2_000);
    expect(report.recoveries.netIncurred).toBe(report.headline.current.incurred - 2_000);
    expect(report.brokerNotes).toBe("Renewal looks good.");
  });

  it("nets reserve changes per claim within the period, largest first", () => {
    const [a, b] = CLAIMS;
    const withChanges = buildExecutiveReport(
      input({
        reserveChanges: [
          {
            claim_id: a.id,
            old_reserve: 1_000,
            new_reserve: 3_000,
            changed_at: "2026-02-01T10:00:00Z",
          },
          {
            claim_id: a.id,
            old_reserve: 3_000,
            new_reserve: 5_000,
            changed_at: "2026-03-01T10:00:00Z",
          },
          { claim_id: b.id, old_reserve: 900, new_reserve: 0, changed_at: "2026-07-01T10:00:00Z" },
          {
            claim_id: b.id,
            old_reserve: 0,
            new_reserve: 50_000,
            changed_at: "2025-07-01T10:00:00Z",
          },
          {
            claim_id: "not-visible",
            old_reserve: 0,
            new_reserve: 99_999,
            changed_at: "2026-07-01T10:00:00Z",
          },
        ],
      }),
    );
    expect(withChanges.reserveChanges.rows.map((r) => [r.id, r.from, r.to, r.change])).toEqual([
      [a.id, 1_000, 5_000, 4_000],
      [b.id, 900, 0, -900],
    ]);
  });

  it("puts loss ratio on premium earned in the period", () => {
    const gl = report.lossRatio.rows.find((r) => r.line === "General Liability")!;
    // 1 Jan to 12 Nov is 316 of the policy's 365 days.
    expect(gl.earnedPremium).toBeCloseTo(36_500 * (316 / 365));
    expect(gl.ratio).toBeCloseTo(gl.incurred / gl.earnedPremium!);
  });
});

describe("earnedPremium", () => {
  it("is pro rata by days inside the range, zero outside, null without data", () => {
    expect(earnedPremium(policy(), { from: "2026-01-01", to: "2026-12-31" })).toBeCloseTo(36_500);
    expect(earnedPremium(policy(), { from: "2025-01-01", to: "2025-12-31" })).toBe(0);
    expect(
      earnedPremium(policy({ premium: null }), { from: "2026-01-01", to: "2026-12-31" }),
    ).toBeNull();
  });
});

describe("report periods", () => {
  it("resolves the presets and comparisons", () => {
    expect(resolveReportPeriod("last-month", TODAY)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(resolveReportPeriod("last-quarter", TODAY)).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
    });
    expect(resolveReportPeriod("last-quarter", "2026-02-10")).toEqual({
      from: "2025-10-01",
      to: "2025-12-31",
    });
    const q = { from: "2026-07-01", to: "2026-09-30" };
    expect(resolveComparison("prior-year", q)).toEqual({ from: "2025-07-01", to: "2025-09-30" });
    expect(resolveComparison("previous", q)).toEqual({ from: "2026-03-31", to: "2026-06-30" });
  });
});

describe("renderExecutiveReportPdf", () => {
  it("draws a PDF on the server", async () => {
    const bytes = await renderExecutiveReportPdf(buildExecutiveReport(input()));
    const head = new TextDecoder().decode(new Uint8Array(bytes).slice(0, 5));
    expect(head).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(5_000);
  });
});
