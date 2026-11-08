// How a loss run request's years and lines are stored, emailed and shown.
// Years always read oldest first, and lines always use the names from the
// lines_of_business table, so a request says "Commercial Property" exactly
// like a policy does.

import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_CODES,
  LINE_OF_BUSINESS_NAMES,
  isLineOfBusinessCode,
  lineOfBusinessName,
  type LineOfBusinessCode,
} from "@/lib/line-of-business";

/** The lines a client can ask for, in form order. "Other" is left off. */
export const LOSS_RUN_REQUEST_LINES = [
  LINE_OF_BUSINESS.generalLiability,
  LINE_OF_BUSINESS.workersComp,
  LINE_OF_BUSINESS.auto,
  LINE_OF_BUSINESS.property,
  LINE_OF_BUSINESS.umbrella,
  LINE_OF_BUSINESS.professional,
  LINE_OF_BUSINESS.cyber,
].map(lineOfBusinessName);

// Hand-typed names that older requests were saved with.
const LEGACY_LINE_NAMES: Record<string, LineOfBusinessCode> = {
  property: LINE_OF_BUSINESS.property,
  "commercial auto": LINE_OF_BUSINESS.auto,
  auto: LINE_OF_BUSINESS.auto,
  "workers comp": LINE_OF_BUSINESS.workersComp,
  "workers' compensation": LINE_OF_BUSINESS.workersComp,
};

function lineCode(value: string): LineOfBusinessCode | undefined {
  const text = value.trim();
  const upper = text.toUpperCase();
  if (isLineOfBusinessCode(upper)) return upper;
  const lower = text.toLowerCase();
  const byName = LINE_OF_BUSINESS_CODES.find(
    (code) => LINE_OF_BUSINESS_NAMES[code].toLowerCase() === lower,
  );
  return byName ?? LEGACY_LINE_NAMES[lower];
}

/** Unique years, oldest first. */
export function sortRequestYears(years: readonly number[] | null | undefined): number[] {
  return [...new Set(years ?? [])].sort((a, b) => a - b);
}

/**
 * Lookup names for the requested lines, unique and in lookup-table order.
 * Codes, any-case names and old hand-typed names ("Property") map to the
 * lookup name; anything unrecognised is kept as typed, at the end.
 */
export function normalizeRequestLines(lines: readonly string[] | null | undefined): string[] {
  const known = new Set<LineOfBusinessCode>();
  const unknown: string[] = [];
  for (const line of lines ?? []) {
    const text = line.trim();
    if (!text) continue;
    const code = lineCode(text);
    if (code) known.add(code);
    else if (!unknown.includes(text)) unknown.push(text);
  }
  const names = LINE_OF_BUSINESS_CODES.filter((code) => known.has(code)).map(lineOfBusinessName);
  return [...names, ...unknown];
}

/** "2022, 2023, 2024" for display and email. */
export function formatRequestYears(years: readonly number[] | null | undefined): string {
  return sortRequestYears(years).join(", ");
}

/** "General Liability, Commercial Property" for display and email. */
export function formatRequestLines(lines: readonly string[] | null | undefined): string {
  return normalizeRequestLines(lines).join(", ");
}
