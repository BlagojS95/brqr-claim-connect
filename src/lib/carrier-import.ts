// Carrier CSV import (fix 53): a carrier's claim report is matched to the
// agency's claims for that carrier by carrier claim number, and the matched
// claims are updated with the carrier's status, amounts, adjuster and closed
// date. Everything here is pure so the preview (browser) and the apply
// (server) run the same matching.

import { z } from "zod";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";
import { mapHeaders, parseMoney } from "@/lib/import-mapping";
import {
  diffClaimValues,
  type ClaimEditableValues,
  type ClaimUpdate,
  type FieldChange,
} from "@/lib/claim-quick-edit";

export const CARRIER_IMPORT_FIELDS = [
  "claim_number",
  "status",
  "paid_amount",
  "reserve_amount",
  "adjuster_name",
  "adjuster_phone",
  "adjuster_email",
  "closed_date",
] as const;

export type CarrierImportField = (typeof CARRIER_IMPORT_FIELDS)[number];

export const CARRIER_IMPORT_FIELD_LABELS: Record<CarrierImportField, string> = {
  claim_number: "Carrier claim number",
  status: "Status",
  paid_amount: "Paid",
  reserve_amount: "Reserve",
  adjuster_name: "Adjuster name",
  adjuster_phone: "Adjuster phone",
  adjuster_email: "Adjuster email",
  closed_date: "Closed date",
};

/** The largest file one import takes. */
export const MAX_CARRIER_IMPORT_ROWS = 5000;
/** Rows per apply request, so one request stays small and quick. */
export const CARRIER_IMPORT_CHUNK = 200;

/** field -> the CSV column header it is read from. */
export type CarrierMapping = Partial<Record<CarrierImportField, string>>;

const header = z.string().trim().min(1).max(200);

export const CarrierMappingSchema = z
  .object({
    claim_number: header,
    status: header.optional(),
    paid_amount: header.optional(),
    reserve_amount: header.optional(),
    adjuster_name: header.optional(),
    adjuster_phone: header.optional(),
    adjuster_email: header.optional(),
    closed_date: header.optional(),
  })
  .strict();

export const CarrierNameSchema = z
  .string()
  .trim()
  .min(1, "Choose a carrier")
  .max(200, "Carrier names can be at most 200 characters");

/** One row of the file, already read through the mapping. */
export interface CarrierRow {
  /** Row number as seen in the spreadsheet (header is row 1). */
  row: number;
  values: Partial<Record<CarrierImportField, string>>;
}

export const CarrierRowSchema = z.object({
  row: z
    .number()
    .int()
    .min(2)
    .max(MAX_CARRIER_IMPORT_ROWS + 1),
  values: z
    .object(
      Object.fromEntries(
        CARRIER_IMPORT_FIELDS.map((f) => [f, z.string().max(500).optional()]),
      ) as Record<CarrierImportField, z.ZodOptional<z.ZodString>>,
    )
    .strict(),
});

/** A first guess at the mapping from the column headers (same aliases as the claims import). */
export function guessCarrierMapping(headers: readonly string[]): CarrierMapping {
  const { fields } = mapHeaders("claims", [...headers]);
  const out: CarrierMapping = {};
  for (const field of CARRIER_IMPORT_FIELDS) {
    if (fields[field]) out[field] = fields[field];
  }
  return out;
}

/** A saved mapping, minus columns this file doesn't have. */
export function usableMapping(saved: CarrierMapping, headers: readonly string[]): CarrierMapping {
  const present = new Set(headers);
  const out: CarrierMapping = {};
  for (const field of CARRIER_IMPORT_FIELDS) {
    const column = saved[field];
    if (column && present.has(column)) out[field] = column;
  }
  return out;
}

export function applyCarrierMapping(
  rows: readonly Record<string, string>[],
  mapping: CarrierMapping,
): CarrierRow[] {
  return rows.map((record, i) => {
    const values: CarrierRow["values"] = {};
    for (const field of CARRIER_IMPORT_FIELDS) {
      const column = mapping[field];
      const value = column ? String(record[column] ?? "").trim() : "";
      if (value) values[field] = value;
    }
    return { row: i + 2, values };
  });
}

/** "trv 123 " and "TRV123" are the same claim number. */
export function normalizeClaimNumber(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toLowerCase();
}

/**
 * A carrier's status word -> our status, given what the claim is now.
 * "Open" on a closed claim means it was reopened, and "Open" on a reopened
 * claim leaves it reopened. Returns undefined for a blank cell and "unknown"
 * for a word we don't recognise; either way the status is left alone.
 */
export function carrierStatus(
  text: string | undefined,
  current: ClaimStatus,
): ClaimStatus | undefined | "unknown" {
  const word = text
    ?.trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
  if (!word) return undefined;
  if (/^re ?open/.test(word)) return CLAIM_STATUS.reopened;
  if (/^(clos|settled|denied|withdrawn|declined|paid in full|final)/.test(word))
    return CLAIM_STATUS.closed;
  if (
    /^(open|active|pending|in progress|under review|new|reported|investigat|working)/.test(word)
  ) {
    if (current === CLAIM_STATUS.closed || current === CLAIM_STATUS.reopened) {
      return CLAIM_STATUS.reopened;
    }
    return CLAIM_STATUS.open;
  }
  return "unknown";
}

/**
 * A date cell -> "YYYY-MM-DD", or null when it can't be read. Accepts ISO
 * (2026-03-05, also with a time after it) and US month-first (3/5/2026,
 * 03-05-26). Works on the text only, never new Date().
 */
export function parseImportDate(value: string): string | null {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(text);
  const us = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:$|\s)/.exec(text);
  let y: number, m: number, d: number;
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) {
    y = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    [m, d] = [Number(us[1]), Number(us[2])];
  } else return null;
  const daysInMonth = [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth[m - 1]) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A claim of the chosen carrier, as the matching needs it. */
export interface CarrierClaim extends ClaimEditableValues {
  id: string;
  client_name: string | null;
}

export interface MatchedRow {
  row: number;
  claimId: string;
  claimNumber: string;
  clientName: string | null;
  update: ClaimUpdate;
  changes: FieldChange[];
  /** Cells that were ignored, e.g. an amount that isn't a number. */
  warnings: string[];
}

export interface UnmatchedRow {
  row: number;
  claimNumber: string | null;
  reason: string;
}

export interface CarrierImportPreview {
  /** Matched rows that change something. */
  changed: MatchedRow[];
  /** Matched rows that change nothing. */
  unchanged: MatchedRow[];
  unmatched: UnmatchedRow[];
}

/** The new values a row asks for, read from its cells, plus any cells skipped. */
export function rowValues(
  values: CarrierRow["values"],
  current: ClaimEditableValues,
): { next: Partial<ClaimEditableValues>; warnings: string[] } {
  const next: Partial<ClaimEditableValues> = {};
  const warnings: string[] = [];

  const status = carrierStatus(values.status, current.status);
  if (status === "unknown") warnings.push(`Status "${values.status}" not recognised, left as is`);
  else if (status) next.status = status;

  for (const field of ["paid_amount", "reserve_amount"] as const) {
    const text = values[field];
    if (!text) continue;
    const amount = parseMoney(text);
    if (amount == null)
      warnings.push(`${field === "paid_amount" ? "Paid" : "Reserve"} "${text}" isn't an amount`);
    else if (amount < 0)
      warnings.push(`${field === "paid_amount" ? "Paid" : "Reserve"} can't be negative (${text})`);
    else next[field] = Math.round(amount * 100) / 100;
  }

  for (const field of ["adjuster_name", "adjuster_phone", "adjuster_email"] as const) {
    if (values[field]) next[field] = values[field];
  }
  if (next.adjuster_email && !z.string().email().safeParse(next.adjuster_email).success) {
    warnings.push(`Adjuster email "${next.adjuster_email}" isn't an email address`);
    delete next.adjuster_email;
  }

  if (values.closed_date) {
    const date = parseImportDate(values.closed_date);
    if (date) next.closed_date = date;
    else warnings.push(`Closed date "${values.closed_date}" isn't a date`);
  }
  return { next, warnings };
}

/**
 * Matches each row to a claim of the carrier by carrier claim number (case and
 * spaces ignored) and works out what it would change. Blank cells never clear
 * a stored value. A claim number seen twice in the file is used once.
 */
export function buildCarrierImportPreview(
  rows: readonly CarrierRow[],
  claims: readonly CarrierClaim[],
): CarrierImportPreview {
  const byNumber = new Map<string, CarrierClaim[]>();
  for (const claim of claims) {
    const key = normalizeClaimNumber(claim.claim_number);
    if (!key) continue;
    byNumber.set(key, [...(byNumber.get(key) ?? []), claim]);
  }

  const preview: CarrierImportPreview = { changed: [], unchanged: [], unmatched: [] };
  const seen = new Map<string, number>();
  for (const { row, values } of rows) {
    const claimNumber = values.claim_number?.trim() || null;
    const key = normalizeClaimNumber(claimNumber);
    if (!claimNumber || !key) {
      preview.unmatched.push({ row, claimNumber: null, reason: "No claim number" });
      continue;
    }
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      preview.unmatched.push({ row, claimNumber, reason: `Same claim number as row ${earlier}` });
      continue;
    }
    seen.set(key, row);

    const found = byNumber.get(key) ?? [];
    if (found.length === 0) {
      preview.unmatched.push({
        row,
        claimNumber,
        reason: "No claim with this number for this carrier",
      });
      continue;
    }
    if (found.length > 1) {
      preview.unmatched.push({
        row,
        claimNumber,
        reason: `${found.length} claims have this number; update them by hand`,
      });
      continue;
    }

    const claim = found[0];
    const { next, warnings } = rowValues(values, claim);
    const { update, changes } = diffClaimValues(claim, next);
    const matched: MatchedRow = {
      row,
      claimId: claim.id,
      claimNumber: claim.claim_number ?? claimNumber,
      clientName: claim.client_name,
      update,
      changes,
      warnings,
    };
    (changes.length ? preview.changed : preview.unchanged).push(matched);
  }
  return preview;
}

/** Escapes LIKE wildcards so a carrier name is matched literally (case-insensitive). */
export function ilikeExact(value: string): string {
  return value.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Distinct carrier names (case-insensitive), with claim counts, by name. */
export function distinctCarriers(
  values: readonly (string | null)[],
): { name: string; claims: number }[] {
  const byKey = new Map<string, { name: string; claims: number }>();
  for (const value of values) {
    const name = value?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const entry = byKey.get(key);
    if (entry) entry.claims++;
    else byKey.set(key, { name, claims: 1 });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}
