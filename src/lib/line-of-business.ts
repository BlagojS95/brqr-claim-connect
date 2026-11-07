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
