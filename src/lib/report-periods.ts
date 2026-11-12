// The executive report's period and comparison choices (fix 46). The ranges
// use the same date logic as the Insights period (insights-period.ts), so a
// report for "Year to date" matches Insights set to "Year to date".

import {
  addDays,
  addYears,
  currentPolicyTerm,
  resolvePeriod,
  type DateRange,
  type PolicyTermFields,
} from "@/lib/insights-period";

export const REPORT_PERIODS = [
  "last-month",
  "last-quarter",
  "ytd",
  "last12",
  "policy",
  "custom",
] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  "last-month": "Last month",
  "last-quarter": "Last quarter",
  ytd: "Year to date",
  last12: "Last 12 months",
  policy: "Policy year",
  custom: "Custom",
};

export const COMPARISONS = ["prior-year", "previous", "custom"] as const;
export type Comparison = (typeof COMPARISONS)[number];

export const COMPARISON_LABELS: Record<Comparison, string> = {
  "prior-year": "Same period last year",
  previous: "The period just before",
  custom: "Custom",
};

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function resolveReportPeriod(
  preset: ReportPeriod,
  today: string,
  policies: readonly PolicyTermFields[] = [],
  custom?: Partial<DateRange>,
): DateRange | null {
  switch (preset) {
    case "last-month": {
      const end = addDays(monthStart(today), -1);
      return { from: monthStart(end), to: end };
    }
    case "last-quarter": {
      const month = Number(today.slice(5, 7));
      const quarterStart = `${today.slice(0, 4)}-${String(month - ((month - 1) % 3)).padStart(2, "0")}-01`;
      const end = addDays(quarterStart, -1);
      const startMonth = Number(end.slice(5, 7)) - 2;
      return { from: `${end.slice(0, 4)}-${String(startMonth).padStart(2, "0")}-01`, to: end };
    }
    case "ytd":
      return resolvePeriod({ period: "ytd", today });
    case "last12":
      return resolvePeriod({ period: "last12", today });
    case "policy":
      return currentPolicyTerm(policies, today);
    case "custom":
      return resolvePeriod({ period: "custom", from: custom?.from, to: custom?.to });
  }
}

function daysInRange(r: DateRange): number {
  return (
    Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) +
    1
  );
}

export function resolveComparison(
  kind: Comparison,
  period: DateRange,
  custom?: Partial<DateRange>,
): DateRange | null {
  switch (kind) {
    case "prior-year":
      return { from: addYears(period.from, -1), to: addYears(period.to, -1) };
    case "previous": {
      const to = addDays(period.from, -1);
      return { from: addDays(to, -(daysInRange(period) - 1)), to };
    }
    case "custom":
      return resolvePeriod({ period: "custom", from: custom?.from, to: custom?.to });
  }
}
