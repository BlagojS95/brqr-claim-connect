// The line-of-business codes, matching the `code` column of the
// lines_of_business table (supabase/migrations/20261101000000_lines_of_business.sql).
// Code that branches on a line uses these constants, never names or raw strings.

export const LINE_OF_BUSINESS_CODES = [
  "GL",
  "AUTO",
  "WC",
  "PROP",
  "UMB",
  "PROF",
  "CYBER",
  "OTHER",
] as const;

export type LineOfBusinessCode = (typeof LINE_OF_BUSINESS_CODES)[number];

export const LINE_OF_BUSINESS = {
  generalLiability: "GL",
  auto: "AUTO",
  workersComp: "WC",
  property: "PROP",
  umbrella: "UMB",
  professional: "PROF",
  cyber: "CYBER",
  other: "OTHER",
} as const satisfies Record<string, LineOfBusinessCode>;

export function isLineOfBusinessCode(value: unknown): value is LineOfBusinessCode {
  return typeof value === "string" && (LINE_OF_BUSINESS_CODES as readonly string[]).includes(value);
}

/** The `name` column of the lines_of_business table, by code. */
export const LINE_OF_BUSINESS_NAMES = {
  GL: "General Liability",
  AUTO: "Business Auto",
  WC: "Workers Compensation",
  PROP: "Commercial Property",
  UMB: "Umbrella",
  PROF: "Professional Liability",
  CYBER: "Cyber",
  OTHER: "Other",
} as const satisfies Record<LineOfBusinessCode, string>;

export type LineOfBusinessName = (typeof LINE_OF_BUSINESS_NAMES)[LineOfBusinessCode];

export function lineOfBusinessName(code: LineOfBusinessCode): LineOfBusinessName {
  return LINE_OF_BUSINESS_NAMES[code];
}
