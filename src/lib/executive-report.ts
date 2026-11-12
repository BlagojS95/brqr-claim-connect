// The executive loss report (fix 46): pure calculations, shared by the
// Reports tab, the server-rendered PDF, shared links and the monthly email.
//
// Headline figures use the same functions as Insights (claimsInRange by date
// of loss, then claimTotals), so the report and Insights agree for a period.

import {
  claimTotals,
  incurredAmount,
  isOpen,
  paidAmount,
  recoveryAmount,
  reserveAmount,
  type ClaimTotals,
} from "@/lib/claim-metrics";
import { CLAIM_STATUS_LABELS } from "@/lib/claim-status";
import { breakdownBy } from "@/lib/insights-breakdowns";
import { claimsInRange, percentChange, type DateRange } from "@/lib/insights-period";
import type { AgencyClaim, AgencyPolicy } from "@/lib/overview.types";
import {
  isWorkersCompLine,
  lossRatio,
  policyLineName,
  type LineOfBusinessRow,
} from "@/lib/renewal-pack";

export const DEFAULT_LARGE_LOSS_THRESHOLD = 25_000;
export const MAX_LARGE_LOSS_THRESHOLD = 100_000_000;
export const OLDEST_OPEN_LIMIT = 5;
export const RESERVE_CHANGE_LIMIT = 10;
export const FREQUENCY_ROW_LIMIT = 10;

export const WC_CLAIM_KIND = { lostTime: "lost_time", medicalOnly: "medical_only" } as const;
export const WC_CLAIM_KIND_LABELS = {
  lost_time: "Lost time",
  medical_only: "Medical only",
} as const;

export const AGING_BUCKETS = [
  { label: "0–90 days", max: 90 },
  { label: "91–180 days", max: 180 },
  { label: "181–365 days", max: 365 },
  { label: "Over 365 days", max: Infinity },
] as const;

export type ReportClaim = Pick<
  AgencyClaim,
  | "id"
  | "claim_number"
  | "claim_type"
  | "status"
  | "line_of_business"
  | "carrier"
  | "date_of_loss"
  | "date_reported"
  | "created_at"
  | "paid_amount"
  | "reserve_amount"
  | "recovery_amount"
  | "cause_of_loss"
  | "policy_number"
  | "loss_location"
  | "location_name"
  | "is_litigated"
  | "wc_claim_kind"
>;

export type ReportPolicy = Pick<
  AgencyPolicy,
  | "policy_number"
  | "policy_type"
  | "line_of_business_id"
  | "effective_date"
  | "expiry_date"
  | "premium"
  | "experience_mod"
>;

export interface ReserveChange {
  claim_id: string;
  old_reserve: number | null;
  new_reserve: number | null;
  changed_at: string;
}

export interface ExecutiveReportInput {
  clientName: string;
  period: DateRange;
  comparison: DateRange;
  threshold: number;
  brokerNotes: string | null;
  /** "YYYY-MM-DD"; the report is valued as of this day. */
  today: string;
  claims: readonly ReportClaim[];
  policies: readonly ReportPolicy[];
  lines: readonly LineOfBusinessRow[];
  reserveChanges: readonly ReserveChange[];
  /** The first recorded reserve change, if any: history starts there. */
  reserveHistorySince: string | null;
}

/** A claim as the report lists it: no claimant or employee names. */
export interface ReportClaimRow {
  id: string;
  claimNumber: string | null;
  dateOfLoss: string | null;
  line: string;
  type: string;
  status: string;
  paid: number;
  reserve: number;
  incurred: number;
}

export interface FrequencyRow {
  name: string;
  count: number;
  incurred: number;
  /** Severity: incurred per claim. */
  average: number;
}

export interface LossRatioRow {
  line: string;
  claims: number;
  incurred: number;
  /** Premium earned during the period, pro rata by days; null when none is on file. */
  earnedPremium: number | null;
  ratio: number | null;
}

export interface CountAndIncurred {
  count: number;
  incurred: number;
}

export interface ExecutiveReport {
  version: 1;
  clientName: string;
  valuedAsOf: string;
  period: DateRange;
  comparison: DateRange;
  threshold: number;
  brokerNotes: string | null;
  headline: {
    current: ClaimTotals;
    comparison: ClaimTotals;
    change: Record<keyof ClaimTotals, number | null>;
  };
  lossRatio: { rows: LossRatioRow[]; total: LossRatioRow };
  largeLosses: ReportClaimRow[];
  aging: {
    open: number;
    buckets: { label: string; count: number; incurred: number }[];
    oldest: (ReportClaimRow & { ageDays: number })[];
  };
  reserveChanges: {
    rows: (ReportClaimRow & { from: number; to: number; change: number })[];
    historySince: string | null;
  };
  frequencySeverity: { cause: FrequencyRow[]; location: FrequencyRow[]; line: FrequencyRow[] };
  workersComp: {
    claims: number;
    lostTime: CountAndIncurred;
    medicalOnly: CountAndIncurred;
    notRecorded: CountAndIncurred;
    experienceMods: { policyNumber: string; mod: number; term: string }[];
  };
  litigation: { count: number; incurred: number; claims: ReportClaimRow[] };
  recoveries: { total: number; claims: number; incurred: number; netIncurred: number };
}

const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function toReportRow(c: ReportClaim): ReportClaimRow {
  return {
    id: c.id,
    claimNumber: c.claim_number,
    dateOfLoss: day(c.date_of_loss),
    line: c.line_of_business,
    type: c.claim_type,
    status: CLAIM_STATUS_LABELS[c.status],
    paid: paidAmount(c),
    reserve: reserveAmount(c),
    incurred: incurredAmount(c),
  };
}

/**
 * Premium a policy earns within the range, pro rata by days of its term that
 * fall inside. Null without a premium or a complete term.
 */
export function earnedPremium(policy: ReportPolicy, range: DateRange): number | null {
  const start = day(policy.effective_date);
  const end = day(policy.expiry_date);
  if (policy.premium === null || !start || !end || end < start) return null;
  const termDays = Math.max(1, daysBetween(start, end));
  const overlapStart = start > range.from ? start : range.from;
  const overlapEnd = end < range.to ? end : range.to;
  if (overlapEnd < overlapStart) return 0;
  const overlap = Math.min(termDays, daysBetween(overlapStart, overlapEnd) + 1);
  return (Number(policy.premium) * overlap) / termDays;
}

function frequencyRows(rows: { name: string; count: number; incurred: number }[]): FrequencyRow[] {
  return rows
    .map((r) => ({
      name: r.name,
      count: r.count,
      incurred: r.incurred,
      average: r.count ? r.incurred / r.count : 0,
    }))
    .sort((a, b) => b.count - a.count || b.incurred - a.incurred || a.name.localeCompare(b.name))
    .slice(0, FREQUENCY_ROW_LIMIT);
}

function countAndIncurred(claims: readonly ReportClaim[]): CountAndIncurred {
  return { count: claims.length, incurred: claims.reduce((s, c) => s + incurredAmount(c), 0) };
}

function claimAge(c: ReportClaim, today: string): number {
  const opened = day(c.date_reported) ?? day(c.date_of_loss) ?? day(c.created_at) ?? today;
  return Math.max(0, daysBetween(opened, today));
}

export function buildExecutiveReport(input: ExecutiveReportInput): ExecutiveReport {
  const { claims, period, comparison, today, lines } = input;
  const inPeriod = claimsInRange(claims, period);
  const inComparison = claimsInRange(claims, comparison);
  const current = claimTotals(inPeriod);
  const before = claimTotals(inComparison);
  const change = Object.fromEntries(
    (Object.keys(current) as (keyof ClaimTotals)[]).map((k) => [
      k,
      percentChange(current[k], before[k]),
    ]),
  ) as Record<keyof ClaimTotals, number | null>;

  // Loss ratio by line: the period's incurred over the premium earned in it.
  const lineNames = [...new Set(inPeriod.map((c) => c.line_of_business))];
  for (const p of input.policies) {
    const name = policyLineName(p, [...lines]);
    if (name && (earnedPremium(p, period) ?? 0) > 0 && !lineNames.includes(name))
      lineNames.push(name);
  }
  const lossRatioRows = lineNames
    .map((line): LossRatioRow => {
      const lineClaims = inPeriod.filter((c) => c.line_of_business === line);
      const premiums = input.policies
        .filter((p) => policyLineName(p, [...lines]) === line)
        .map((p) => earnedPremium(p, period))
        .filter((n): n is number => n !== null);
      const premium = premiums.length ? premiums.reduce((s, n) => s + n, 0) : null;
      const incurred = lineClaims.reduce((s, c) => s + incurredAmount(c), 0);
      return {
        line,
        claims: lineClaims.length,
        incurred,
        earnedPremium: premium,
        ratio: lossRatio(incurred, premium),
      };
    })
    .sort((a, b) => b.incurred - a.incurred || a.line.localeCompare(b.line));
  const withPremium = lossRatioRows.filter((r) => r.earnedPremium !== null);
  const totalPremium = withPremium.length
    ? withPremium.reduce((s, r) => s + (r.earnedPremium ?? 0), 0)
    : null;
  const lossRatioTotal: LossRatioRow = {
    line: "All lines",
    claims: inPeriod.length,
    incurred: current.incurred,
    earnedPremium: totalPremium,
    // Only lines with premium on file count towards the overall ratio.
    ratio: lossRatio(
      withPremium.reduce((s, r) => s + r.incurred, 0),
      totalPremium,
    ),
  };

  const largeLosses = inPeriod
    .filter((c) => incurredAmount(c) >= input.threshold && incurredAmount(c) > 0)
    .map(toReportRow)
    .sort((a, b) => b.incurred - a.incurred);

  // Aging covers every open claim today, whenever the loss happened.
  const open = claims.filter(isOpen);
  const aged = open.map((c) => ({ claim: c, age: claimAge(c, today) }));
  const buckets = AGING_BUCKETS.map((b, i) => {
    const min = i === 0 ? 0 : AGING_BUCKETS[i - 1].max + 1;
    const inBucket = aged.filter((a) => a.age >= min && a.age <= b.max);
    return {
      label: b.label,
      count: inBucket.length,
      incurred: inBucket.reduce((s, a) => s + incurredAmount(a.claim), 0),
    };
  });
  const oldest = [...aged]
    .sort((a, b) => b.age - a.age)
    .slice(0, OLDEST_OPEN_LIMIT)
    .map((a) => ({ ...toReportRow(a.claim), ageDays: a.age }));

  // Reserve changes during the period, netted per claim.
  const byClaim = new Map(claims.map((c) => [c.id, c]));
  const changes = new Map<string, { from: number; to: number }>();
  for (const ch of [...input.reserveChanges].sort((a, b) =>
    a.changed_at.localeCompare(b.changed_at),
  )) {
    const when = ch.changed_at.slice(0, 10);
    if (when < period.from || when > period.to || !byClaim.has(ch.claim_id)) continue;
    const entry = changes.get(ch.claim_id);
    if (entry) entry.to = Number(ch.new_reserve ?? 0);
    else
      changes.set(ch.claim_id, {
        from: Number(ch.old_reserve ?? 0),
        to: Number(ch.new_reserve ?? 0),
      });
  }
  const reserveRows = [...changes]
    .map(([id, { from, to }]) => ({
      ...toReportRow(byClaim.get(id) as ReportClaim),
      from,
      to,
      change: to - from,
    }))
    .filter((r) => r.change !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, RESERVE_CHANGE_LIMIT);

  const wcClaims = inPeriod.filter((c) => isWorkersCompLine(c.line_of_business, [...lines]));
  const experienceMods = input.policies
    .filter((p) => {
      const name = policyLineName(p, [...lines]);
      return (
        name !== null &&
        isWorkersCompLine(name, [...lines]) &&
        p.experience_mod !== null &&
        (earnedPremium(p, period) ?? 1) > 0
      );
    })
    .map((p) => ({
      policyNumber: p.policy_number,
      mod: Number(p.experience_mod),
      term: `${day(p.effective_date) ?? "?"} – ${day(p.expiry_date) ?? "?"}`,
    }));

  const litigated = inPeriod.filter((c) => c.is_litigated);
  const withRecovery = inPeriod.filter((c) => recoveryAmount(c) > 0);
  const recoveredTotal = inPeriod.reduce((s, c) => s + recoveryAmount(c), 0);

  return {
    version: 1,
    clientName: input.clientName,
    valuedAsOf: today,
    period,
    comparison,
    threshold: input.threshold,
    brokerNotes: input.brokerNotes?.trim() || null,
    headline: { current, comparison: before, change },
    lossRatio: { rows: lossRatioRows, total: lossRatioTotal },
    largeLosses,
    aging: { open: open.length, buckets, oldest },
    reserveChanges: { rows: reserveRows, historySince: input.reserveHistorySince },
    frequencySeverity: {
      cause: frequencyRows(breakdownBy(inPeriod, "cause")),
      location: frequencyRows(breakdownBy(inPeriod, "location")),
      line: frequencyRows(breakdownBy(inPeriod, "line")),
    },
    workersComp: {
      claims: wcClaims.length,
      lostTime: countAndIncurred(
        wcClaims.filter((c) => c.wc_claim_kind === WC_CLAIM_KIND.lostTime),
      ),
      medicalOnly: countAndIncurred(
        wcClaims.filter((c) => c.wc_claim_kind === WC_CLAIM_KIND.medicalOnly),
      ),
      notRecorded: countAndIncurred(wcClaims.filter((c) => !c.wc_claim_kind)),
      experienceMods,
    },
    litigation: { ...countAndIncurred(litigated), claims: litigated.map(toReportRow) },
    recoveries: {
      total: recoveredTotal,
      claims: withRecovery.length,
      incurred: current.incurred,
      netIncurred: Math.max(0, current.incurred - recoveredTotal),
    },
  };
}
