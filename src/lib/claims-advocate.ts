// Claims advocate (fix 59): the person at the agency a client calls for help
// with a claim, plus the agency's after-hours claims number. Shared by the
// sidebar / mobile Help sheet, /admin and Settings; no Supabase imports.

import { z } from "zod";

export interface AdvocateContact {
  name: string | null;
  phone: string | null;
  email: string | null;
}

export interface ClaimsAdvocateInfo {
  advocate: AdvocateContact | null;
  /** True when the client has no advocate of its own and the agency default is shown. */
  isDefault: boolean;
  afterHoursPhone: string | null;
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

function contact(name?: string | null, phone?: string | null, email?: string | null) {
  const c = { name: clean(name), phone: clean(phone), email: clean(email) };
  return c.name || c.phone || c.email ? c : null;
}

/**
 * The client's own advocate when any of its fields is set, otherwise the
 * agency default. Fields are never mixed between the two.
 */
export function resolveClaimsAdvocate(
  client: {
    advocate_name: string | null;
    advocate_phone: string | null;
    advocate_email: string | null;
  } | null,
  settings: {
    default_advocate_name: string | null;
    default_advocate_phone: string | null;
    default_advocate_email: string | null;
    after_hours_claims_phone: string | null;
  } | null,
): ClaimsAdvocateInfo {
  const own = client
    ? contact(client.advocate_name, client.advocate_phone, client.advocate_email)
    : null;
  const fallback = settings
    ? contact(
        settings.default_advocate_name,
        settings.default_advocate_phone,
        settings.default_advocate_email,
      )
    : null;
  return {
    advocate: own ?? fallback,
    isDefault: !own && !!fallback,
    afterHoursPhone: clean(settings?.after_hours_claims_phone),
  };
}

/** Nothing to show at all: the block is hidden. */
export function hasAdvocateInfo(info: ClaimsAdvocateInfo | null | undefined): boolean {
  return !!info && (!!info.advocate || !!info.afterHoursPhone);
}

/** "tel:" link for a phone as typed ("(555) 123-4567 ext. 2" → "tel:+5551234567,2"). */
export function telHref(phone: string): string {
  const [main, ext] = phone.split(/\s*(?:ext\.?|x|#)\s*/i);
  const plus = main.trim().startsWith("+") ? "+" : "";
  const digits = main.replace(/\D/g, "");
  const extDigits = (ext ?? "").replace(/\D/g, "");
  return `tel:${plus}${digits}${extDigits ? `,${extDigits}` : ""}`;
}

/** The edit form's text fields. */
export interface AdvocateDraft {
  name: string;
  phone: string;
  email: string;
}

export const toAdvocateDraft = (c: AdvocateContact | null | undefined): AdvocateDraft => ({
  name: c?.name ?? "",
  phone: c?.phone ?? "",
  email: c?.email ?? "",
});

// Form input: blank means "not set".
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const phone = z
  .string()
  .trim()
  .max(40)
  .refine(
    (v) => v === "" || (/^[+()\d\s.\-#a-zA-Z]+$/.test(v) && /\d{3}/.test(v.replace(/\D/g, ""))),
    {
      message: "Enter a phone number",
    },
  )
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const email = z
  .string()
  .trim()
  .max(254)
  .refine((v) => v === "" || z.string().email().safeParse(v).success, {
    message: "Enter a valid email address",
  })
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const AdvocateContactSchema = z.object({
  name: optionalText(120),
  phone,
  email,
});

export type AdvocateContactInput = z.input<typeof AdvocateContactSchema>;

export const AdvocateDefaultsSchema = z.object({
  advocate: AdvocateContactSchema,
  afterHoursPhone: phone,
});
