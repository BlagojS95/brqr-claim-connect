// Quick edit for agency staff (fix 53): the schema, and the pure diff that
// turns "what the claim holds" plus "what staff entered" into the columns to
// write and the old -> new lines for the claim_update activity entry. The
// carrier CSV import (src/lib/carrier-import.ts) uses the same diff.

import { z } from "zod";
import { CLAIM_STATUSES, claimStatusLabel, type ClaimStatus } from "@/lib/claim-status";
import { formatDate } from "@/lib/dates";
import { WAITING_ON_VALUES, waitingOnLabel, type WaitingOn } from "@/lib/waiting-on";

/** The claim columns quick edit and the carrier import may change. */
export interface ClaimEditableValues {
  claim_number: string | null;
  adjuster_name: string | null;
  adjuster_phone: string | null;
  adjuster_email: string | null;
  status: ClaimStatus;
  paid_amount: number | null;
  reserve_amount: number | null;
  waiting_on: WaitingOn | null;
  assigned_to: string | null;
  /** timestamptz */
  submitted_to_carrier_at: string | null;
  /** timestamptz */
  first_carrier_contact_at: string | null;
  /** timestamptz holding midnight UTC; its date part is the calendar date */
  closed_date: string | null;
}

export type EditableField = keyof ClaimEditableValues;

export const EDITABLE_FIELD_LABELS: Record<EditableField, string> = {
  claim_number: "Carrier claim #",
  adjuster_name: "Adjuster",
  adjuster_phone: "Adjuster phone",
  adjuster_email: "Adjuster email",
  status: "Status",
  paid_amount: "Paid",
  reserve_amount: "Reserve",
  waiting_on: "Waiting on",
  assigned_to: "Assigned to",
  submitted_to_carrier_at: "Submitted to carrier",
  first_carrier_contact_at: "First carrier contact",
  closed_date: "Closed date",
};

// Order the fields are listed in the activity entry and the import preview.
const FIELD_ORDER: EditableField[] = [
  "claim_number",
  "status",
  "closed_date",
  "paid_amount",
  "reserve_amount",
  "adjuster_name",
  "adjuster_phone",
  "adjuster_email",
  "waiting_on",
  "assigned_to",
  "submitted_to_carrier_at",
  "first_carrier_contact_at",
];

const MAX_AMOUNT = 999_999_999_999;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

const amount = z.number().min(0, "Amounts can't be negative").max(MAX_AMOUNT).nullable();

const timestamp = z
  .string()
  .datetime({ offset: true, message: "Enter a valid date and time" })
  .nullable();

/** What the quick edit panel sends. Every field is sent; only changes are written. */
export const QuickEditSchema = z.object({
  claimId: z.string().uuid(),
  claim_number: optionalText(100),
  adjuster_name: optionalText(200),
  adjuster_phone: optionalText(50),
  adjuster_email: z
    .string()
    .trim()
    .max(254)
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, {
      message: "Enter a valid adjuster email",
    }),
  status: z.enum(CLAIM_STATUSES),
  paid_amount: amount,
  reserve_amount: amount,
  waiting_on: z.enum(WAITING_ON_VALUES).nullable(),
  assigned_to: z.string().uuid().nullable(),
  submitted_to_carrier_at: timestamp,
  first_carrier_contact_at: timestamp,
});

export type QuickEditInput = z.infer<typeof QuickEditSchema>;

export interface FieldChange {
  field: EditableField;
  label: string;
  from: string;
  to: string;
  /** Filled in by the rules below rather than typed by staff. */
  automatic?: boolean;
}

export type ClaimUpdate = Partial<ClaimEditableValues>;

export interface ClaimDiff {
  /** Only the columns that change. Empty when nothing does. */
  update: ClaimUpdate;
  changes: FieldChange[];
}

export interface DiffOptions {
  /** Display name for an assigned_to id; "Unassigned" for null. */
  staffName?: (userId: string | null) => string;
  /** Turns on the quick-edit timestamp rules (see diffClaimValues). */
  now?: Date;
}

const AGENCY_TIME_ZONE = "America/New_York";

/** "$5,000" or "$1,234.50"; "—" for none. */
export function formatMoney(value: number | null | undefined): string {
  if (value == null) return "—";
  const whole = Number.isInteger(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(value);
}

/** A timestamptz as "11/16/2026, 3:05 PM ET" on the agency's clock; "—" for none. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "—";
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: AGENCY_TIME_ZONE,
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(time);
  return `${text} ET`;
}

/** A timestamptz -> the "YYYY-MM-DDTHH:mm" a datetime-local input shows (browser's clock). */
export function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local value (browser's clock, has a time) -> ISO timestamp, or null when blank. */
export function fromDateTimeLocal(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function blank(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function minuteOf(iso: string): number {
  return Math.floor(Date.parse(iso) / 60_000);
}

function same(field: EditableField, a: unknown, b: unknown): boolean {
  if (blank(a) || blank(b)) return blank(a) && blank(b);
  switch (field) {
    case "paid_amount":
    case "reserve_amount":
      return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
    case "closed_date":
      return String(a).slice(0, 10) === String(b).slice(0, 10);
    // A datetime-local input only has minutes, so seconds never count as a change.
    case "submitted_to_carrier_at":
    case "first_carrier_contact_at":
      return minuteOf(String(a)) === minuteOf(String(b));
    default:
      return String(a) === String(b);
  }
}

function display(field: EditableField, value: unknown, options: DiffOptions): string {
  if (field === "assigned_to") {
    const id = blank(value) ? null : String(value);
    return options.staffName ? options.staffName(id) : id ? "Staff member" : "Unassigned";
  }
  if (blank(value)) return "—";
  switch (field) {
    case "paid_amount":
    case "reserve_amount":
      return formatMoney(Number(value));
    case "status":
      return claimStatusLabel(String(value));
    case "waiting_on":
      return waitingOnLabel(value as WaitingOn);
    case "closed_date":
      return formatDate(String(value));
    case "submitted_to_carrier_at":
    case "first_carrier_contact_at":
      return formatDateTime(String(value));
    default:
      return String(value);
  }
}

const ADJUSTER_FIELDS = ["adjuster_name", "adjuster_phone", "adjuster_email"] as const;

/**
 * Compares the stored claim with the new values. Only fields present in `next`
 * are looked at, so the import can send just the columns it mapped.
 *
 * With `options.now` (quick edit), two timestamps fill themselves in when
 * staff leave them empty:
 * - submitted_to_carrier_at, when a carrier claim number is entered for the
 *   first time (the claim must have gone to the carrier to get one);
 * - first_carrier_contact_at, when adjuster name, phone or email is entered
 *   for the first time (the carrier has been in touch).
 */
export function diffClaimValues(
  current: ClaimEditableValues,
  next: Partial<ClaimEditableValues>,
  options: DiffOptions = {},
): ClaimDiff {
  const target: Partial<ClaimEditableValues> = { ...next };
  const automatic = new Set<EditableField>();

  if (options.now) {
    const nowIso = options.now.toISOString();
    const has = (f: EditableField) => f in next;
    if (
      blank(current.submitted_to_carrier_at) &&
      (!has("submitted_to_carrier_at") || blank(next.submitted_to_carrier_at)) &&
      blank(current.claim_number) &&
      has("claim_number") &&
      !blank(next.claim_number)
    ) {
      target.submitted_to_carrier_at = nowIso;
      automatic.add("submitted_to_carrier_at");
    }
    if (
      blank(current.first_carrier_contact_at) &&
      (!has("first_carrier_contact_at") || blank(next.first_carrier_contact_at)) &&
      ADJUSTER_FIELDS.every((f) => blank(current[f])) &&
      ADJUSTER_FIELDS.some((f) => has(f) && !blank(next[f]))
    ) {
      target.first_carrier_contact_at = nowIso;
      automatic.add("first_carrier_contact_at");
    }
  }

  const update: ClaimUpdate = {};
  const changes: FieldChange[] = [];
  for (const field of FIELD_ORDER) {
    if (!(field in target)) continue;
    const to = target[field];
    const from = current[field];
    if (same(field, from, to)) continue;
    (update as Record<string, unknown>)[field] = blank(to) ? null : to;
    changes.push({
      field,
      label: EDITABLE_FIELD_LABELS[field],
      from: display(field, from, options),
      to: display(field, to, options),
      ...(automatic.has(field) ? { automatic: true } : {}),
    });
  }
  return { update, changes };
}

/** "Reserve changed from $0 to $5,000". */
export function describeChange(change: FieldChange): string {
  const text = `${change.label} changed from ${change.from} to ${change.to}`;
  return change.automatic ? `${text} (set automatically)` : text;
}

const MAX_ACTIVITY_BODY = 4000;

/**
 * The claim_update activity text, or null when there is nothing to log. Status
 * is left out: the log_claim_status_change trigger already writes its own entry.
 */
export function claimUpdateActivityBody(
  changes: readonly FieldChange[],
  prefix = "",
): string | null {
  const lines = changes.filter((c) => c.field !== "status").map(describeChange);
  if (!lines.length) return null;
  const body = `${prefix}${lines.join("; ")}`;
  return body.length > MAX_ACTIVITY_BODY ? `${body.slice(0, MAX_ACTIVITY_BODY - 1)}…` : body;
}

/** The column list read for the diff. */
export const CLAIM_EDITABLE_SELECT =
  "claim_number, adjuster_name, adjuster_phone, adjuster_email, status, paid_amount, reserve_amount, waiting_on, assigned_to, submitted_to_carrier_at, first_carrier_contact_at, closed_date";
