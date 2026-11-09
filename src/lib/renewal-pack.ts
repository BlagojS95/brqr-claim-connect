// The renewal pack (fix 36): for each line of business, the last five policy
// years of losses against premium, as an underwriter asks for at renewal.
// Pure calculations only; the PDF is drawn in src/lib/exports/renewal-pack-pdf.ts.
//
// A claim belongs to the policy year of the policy whose term contains its date
// of loss (same client and line, preferring the policy number on the claim).
// Without such a policy it falls back to the calendar year of the date of loss.
// Claims with no date of loss can't be placed in a year and are left out.

import { incurredAmount, paidAmount, reserveAmount } from "@/lib/claim-metrics";
import { calendarYear } from "@/lib/dates";
import { LINE_OF_BUSINESS, type LineOfBusinessCode } from "@/lib/line-of-business";
import type { AgencyClaim, AgencyPolicy } from "@/lib/overview.types";

export const RENEWAL_YEARS = 5;

export type RenewalClaim = Pick<
  AgencyClaim,
  | "id"
  | "claim_number"
  | "claim_type"
  | "claimant_name"
  | "status"
  | "line_of_business"
  | "date_of_loss"
  | "paid_amount"
  | "reserve_amount"
  | "client_id"
  | "policy_number"
>;

export type RenewalPolicy = Pick<
  AgencyPolicy,
  | "client_id"
  | "policy_number"
  | "policy_type"
  | "line_of_business_id"
  | "effective_date"
  | "expiry_date"
  | "premium"
  | "experience_mod"
>;

/** A row of the lines_of_business table. */
export interface LineOfBusinessRow {
  id: string;
  name: string;
  code: string;
}

const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);

/**
 * The line name a policy is written on: its line_of_business_id, or, for
 * older imported rows without one, a policy type that is a line's name or code.
 */
export function policyLineName(
  policy: Pick<RenewalPolicy, "line_of_business_id" | "policy_type">,
  lines: LineOfBusinessRow[],
): string | null {
  if (policy.line_of_business_id) {
    const line = lines.find((l) => l.id === policy.line_of_business_id);
    if (line) return line.name;
  }
  const type = policy.policy_type?.trim().toLowerCase();
  if (!type) return null;
  return (
    lines.find((l) => l.name.toLowerCase() === type || l.code.toLowerCase() === type)?.name ?? null
  );
}

/** True when the term (both ends inclusive) contains the date. Needs both dates. */
export function termContains(
  policy: Pick<RenewalPolicy, "effective_date" | "expiry_date">,
  date: string,
): boolean {
  const start = day(policy.effective_date);
  const end = day(policy.expiry_date);
  const d = date.slice(0, 10);
  return start !== null && end !== null && start <= d && d <= end;
}

/** The policy year a policy's term is known by: the year it takes effect. */
export function policyYearOf(policy: Pick<RenewalPolicy, "effective_date">): number | null {
  return calendarYear(policy.effective_date);
}

/**
 * The policy year a claim is attributed to, from the given policies (already
 * limited to the claim's line). Null only when the claim has no date of loss.
 */
export function claimPolicyYear(
  claim: Pick<RenewalClaim, "date_of_loss" | "client_id" | "policy_number">,
  policies: RenewalPolicy[],
): number | null {
  const loss = day(claim.date_of_loss);
  if (!loss) return null;
  const covering = policies.filter(
    (p) => p.client_id === claim.client_id && termContains(p, loss) && policyYearOf(p) !== null,
  );
  const number = claim.policy_number?.trim();
  const match =
    covering.find((p) => number && p.policy_number.trim() === number) ??
    // Overlapping terms (a rewrite mid-term): the newest one wins.
    [...covering].sort((a, b) =>
      (day(b.effective_date) ?? "").localeCompare(day(a.effective_date) ?? ""),
    )[0];
  return match ? policyYearOf(match) : calendarYear(loss);
}

/** The policy year in force today: the newest term containing today, else this calendar year. */
export function currentPolicyYear(policies: RenewalPolicy[], today: string): number {
  const years = policies
    .filter((p) => termContains(p, today))
    .map(policyYearOf)
    .filter((y): y is number => y !== null);
  return years.length ? Math.max(...years) : Number(today.slice(0, 4));
}

/** Incurred over premium; null (shown as "—") without a premium to divide by. */
export function lossRatio(incurred: number, premium: number | null): number | null {
  return premium && premium > 0 ? incurred / premium : null;
}

export function formatLossRatio(ratio: number | null): string {
  return ratio === null ? "—" : `${(ratio * 100).toFixed(1)}%`;
}

export interface RenewalYear {
  year: number;
  claims: number;
  paid: number;
  reserve: number;
  incurred: number;
  /** Total premium of the line's policies taking effect that year; null when none is stored. */
  premium: number | null;
  lossRatio: number | null;
  /** The current policy year: its claims are still open and growing. */
  developing: boolean;
  /** Workers comp experience mods stored on that year's policies, distinct, in order. */
  experienceMods: number[];
}

export interface RenewalTotals {
  claims: number;
  paid: number;
  reserve: number;
  incurred: number;
  premium: number | null;
  /** Incurred over premium, counting only the years that have premium on file. */
  lossRatio: number | null;
}

export interface RenewalClaimRow<C extends RenewalClaim = RenewalClaim> {
  claim: C;
  policyYear: number;
}

export interface RenewalSection<C extends RenewalClaim = RenewalClaim> {
  line: string;
  isWorkersComp: boolean;
  /** Newest policy year first. */
  years: RenewalYear[];
  totals: RenewalTotals;
  /** The claims counted in `years`, newest loss first. */
  claims: RenewalClaimRow<C>[];
  /** True when any year has an experience mod stored. */
  hasExperienceMods: boolean;
}

export function isWorkersCompLine(line: string, lines: LineOfBusinessRow[]): boolean {
  const code = lines.find((l) => l.name === line)?.code as LineOfBusinessCode | undefined;
  return code === LINE_OF_BUSINESS.workersComp;
}

/** One line's section: the last RENEWAL_YEARS policy years up to the current one. */
export function buildRenewalSection<C extends RenewalClaim>(
  line: string,
  claims: C[],
  policies: RenewalPolicy[],
  lines: LineOfBusinessRow[],
  today: string,
): RenewalSection<C> {
  const linePolicies = policies.filter((p) => policyLineName(p, lines) === line);
  const lineClaims = claims.filter((c) => c.line_of_business === line);
  const current = currentPolicyYear(linePolicies, today);
  const yearList = Array.from({ length: RENEWAL_YEARS }, (_, i) => current - i);

  const rows: RenewalClaimRow<C>[] = [];
  for (const claim of lineClaims) {
    const policyYear = claimPolicyYear(claim, linePolicies);
    if (policyYear !== null && yearList.includes(policyYear)) rows.push({ claim, policyYear });
  }
  rows.sort(
    (a, b) =>
      (day(b.claim.date_of_loss) ?? "").localeCompare(day(a.claim.date_of_loss) ?? "") ||
      (a.claim.claim_number ?? "").localeCompare(b.claim.claim_number ?? ""),
  );

  const years = yearList.map((year): RenewalYear => {
    const inYear = rows.filter((r) => r.policyYear === year).map((r) => r.claim);
    const termPolicies = linePolicies.filter((p) => policyYearOf(p) === year);
    const premiums = termPolicies
      .map((p) => (p.premium === null ? null : Number(p.premium)))
      .filter((n): n is number => n !== null && Number.isFinite(n));
    const premium = premiums.length ? premiums.reduce((s, n) => s + n, 0) : null;
    const paid = inYear.reduce((s, c) => s + paidAmount(c), 0);
    const reserve = inYear.reduce((s, c) => s + reserveAmount(c), 0);
    const incurred = inYear.reduce((s, c) => s + incurredAmount(c), 0);
    const experienceMods = [
      ...new Set(
        termPolicies
          .map((p) => (p.experience_mod === null ? null : Number(p.experience_mod)))
          .filter((n): n is number => n !== null && Number.isFinite(n)),
      ),
    ];
    return {
      year,
      claims: inYear.length,
      paid,
      reserve,
      incurred,
      premium,
      lossRatio: lossRatio(incurred, premium),
      developing: year === current,
      experienceMods,
    };
  });

  const withPremium = years.filter((y) => y.premium !== null);
  const premiumTotal = withPremium.length
    ? withPremium.reduce((s, y) => s + (y.premium ?? 0), 0)
    : null;
  const totals: RenewalTotals = {
    claims: years.reduce((s, y) => s + y.claims, 0),
    paid: years.reduce((s, y) => s + y.paid, 0),
    reserve: years.reduce((s, y) => s + y.reserve, 0),
    incurred: years.reduce((s, y) => s + y.incurred, 0),
    premium: premiumTotal,
    lossRatio: lossRatio(
      withPremium.reduce((s, y) => s + y.incurred, 0),
      premiumTotal,
    ),
  };

  return {
    line,
    isWorkersComp: isWorkersCompLine(line, lines),
    years,
    totals,
    claims: rows,
    hasExperienceMods: years.some((y) => y.experienceMods.length > 0),
  };
}

/**
 * The lines to offer, in the lines_of_business order: every line with a
 * policy or a claim. `withPolicies` are the ones ticked by default.
 */
export function renewalLineChoices(
  claims: Pick<RenewalClaim, "line_of_business">[],
  policies: RenewalPolicy[],
  lines: LineOfBusinessRow[],
): { all: string[]; withPolicies: string[] } {
  const policyLines = new Set(
    policies.map((p) => policyLineName(p, lines)).filter((n): n is string => n !== null),
  );
  const claimLines = new Set(claims.map((c) => c.line_of_business));
  const known = lines.map((l) => l.name);
  // Claim lines missing from the table (shouldn't happen) still get offered, last.
  const extra = [...claimLines].filter((n) => !known.includes(n)).sort();
  const all = [...known, ...extra].filter((n) => policyLines.has(n) || claimLines.has(n));
  return { all, withPolicies: all.filter((n) => policyLines.has(n)) };
}
