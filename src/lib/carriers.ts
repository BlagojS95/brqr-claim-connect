// Short carrier names for tight spaces (claims table, mobile cards). The full
// name stays available, e.g. in a title attribute.

const SHORT_NAMES: { pattern: RegExp; short: string }[] = [
  { pattern: /^chubb\b/i, short: "Chubb" },
  { pattern: /^(the\s+)?travelers\b/i, short: "Travelers" },
  { pattern: /^(the\s+)?hartford\b/i, short: "Hartford" },
  { pattern: /^liberty\s+mutual\b/i, short: "Liberty Mutual" },
];

/** "Chubb Group of Insurance Companies" -> "Chubb". Unknown carriers come back unchanged. */
export function carrierShortName(full: string): string;
export function carrierShortName(full: string | null | undefined): string | null;
export function carrierShortName(full: string | null | undefined): string | null {
  if (full == null) return null;
  const name = full.trim();
  for (const { pattern, short } of SHORT_NAMES) {
    if (pattern.test(name)) return short;
  }
  return full;
}
