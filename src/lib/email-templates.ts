// Carrier email templates (fix 54): the placeholders a template can use, how
// they are filled from a claim, and the limits the server enforces. Pure, so
// the dialog (preview) and the server (send) fill templates the same way.
import { formatDate } from "@/lib/dates";
import { DEFAULT_BROKER_CLAIMS_EMAIL } from "@/lib/claim-contacts";

/** Seeded templates the app knows by key (email_templates.key). */
export const EMAIL_TEMPLATE_KEY = {
  firstNoticeOfLoss: "first_notice_of_loss",
  statusRequest: "status_request",
  documentFollowUp: "document_follow_up",
} as const;

export const MAX_TEMPLATE_NAME_LENGTH = 100;
export const MAX_EMAIL_SUBJECT_LENGTH = 300;
export const MAX_EMAIL_BODY_LENGTH = 20_000;

export const EMAIL_TEMPLATES_QUERY_KEY = ["email-templates"] as const;

export const EMAIL_PLACEHOLDERS = [
  "claim_number",
  "date_of_loss",
  "insured",
  "adjuster_name",
  "policy_number",
  "line_of_business",
  "carrier",
  "claimant_name",
  "loss_location",
  "description",
  "broker_claims_email",
] as const;

export type EmailPlaceholder = (typeof EMAIL_PLACEHOLDERS)[number];
export type EmailTemplateValues = Record<EmailPlaceholder, string>;

export const EMAIL_PLACEHOLDER_LABELS: Record<EmailPlaceholder, string> = {
  claim_number: "Carrier claim number",
  date_of_loss: "Date of loss",
  insured: "Insured (client name)",
  adjuster_name: "Adjuster name",
  policy_number: "Policy number",
  line_of_business: "Line of business",
  carrier: "Carrier",
  claimant_name: "Claimant",
  loss_location: "Loss location",
  description: "Loss description",
  broker_claims_email: "Agency claims inbox",
};

// What a placeholder becomes when the claim has no value for it, so a sent
// email never shows "{claim_number}" or an empty gap.
const BLANK_VALUES: Record<EmailPlaceholder, string> = {
  claim_number: "pending",
  date_of_loss: "—",
  insured: "—",
  adjuster_name: "Claims Adjuster",
  policy_number: "—",
  line_of_business: "—",
  carrier: "—",
  claimant_name: "—",
  loss_location: "—",
  description: "—",
  broker_claims_email: DEFAULT_BROKER_CLAIMS_EMAIL,
};

/** The claim fields the placeholders read. */
export interface EmailTemplateClaim {
  claim_number: string | null;
  date_of_loss: string | null;
  adjuster_name: string | null;
  policy_number: string | null;
  line_of_business: string | null;
  carrier: string | null;
  claimant_name: string | null;
  loss_location: string | null;
  description: string | null;
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Placeholder values for a claim; blanks get a readable stand-in. */
export function claimTemplateValues(
  claim: EmailTemplateClaim,
  extra: { insured: string | null | undefined; brokerClaimsEmail: string | null | undefined },
): EmailTemplateValues {
  const raw: EmailTemplateValues = {
    claim_number: clean(claim.claim_number),
    date_of_loss: formatDate(claim.date_of_loss, ""),
    insured: clean(extra.insured),
    adjuster_name: clean(claim.adjuster_name),
    policy_number: clean(claim.policy_number),
    line_of_business: clean(claim.line_of_business),
    carrier: clean(claim.carrier),
    claimant_name: clean(claim.claimant_name),
    loss_location: clean(claim.loss_location),
    description: clean(claim.description),
    broker_claims_email: clean(extra.brokerClaimsEmail),
  };
  const values = {} as EmailTemplateValues;
  for (const key of EMAIL_PLACEHOLDERS) values[key] = raw[key] || BLANK_VALUES[key];
  return values;
}

function isPlaceholder(name: string): name is EmailPlaceholder {
  return (EMAIL_PLACEHOLDERS as readonly string[]).includes(name);
}

/** Replaces each known {placeholder}; unknown ones are left as typed. */
export function fillTemplate(text: string, values: EmailTemplateValues): string {
  return text.replace(/\{([a-z_]+)\}/g, (match, name: string) =>
    isPlaceholder(name) ? values[name] : match,
  );
}

/** {placeholders} in a template that aren't supported, for a warning while editing. */
export function unknownPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const [, name] of text.matchAll(/\{([a-z_]+)\}/g)) {
    if (!isPlaceholder(name)) found.add(name);
  }
  return [...found];
}

/** Carrier inbox if the claim has one, else the adjuster's email, else blank. */
export function defaultCarrierRecipient(claim: {
  carrier_email: string | null;
  adjuster_email: string | null;
}): string {
  return clean(claim.carrier_email) || clean(claim.adjuster_email);
}

// Deliberately simple: one @, something on each side, a dot in the domain, no
// spaces or commas (one recipient only).
const EMAIL_PATTERN = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

const MAX_ACTIVITY_BODY = 4000;

/** The claim_activity line for a sent carrier email. */
export function carrierEmailActivityBody(to: string, templateName: string, subject: string) {
  const body = `Email sent to carrier (${to.trim()}): ${templateName.trim()} — ${subject.trim()}`;
  return body.length > MAX_ACTIVITY_BODY ? `${body.slice(0, MAX_ACTIVITY_BODY - 1)}…` : body;
}
