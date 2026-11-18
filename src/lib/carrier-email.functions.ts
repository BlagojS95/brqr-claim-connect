// Carrier email templates (fix 54): the "Email carrier" dialog on claim detail
// and the template manager in Settings. Agency staff only; every function
// checks the role on the server with requireAgencyAdmin.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { loadDevVars } from "@/lib/load-dev-vars.server";
import { deliverCarrierEmail } from "@/lib/carrier-email.server";
import { parseInput } from "@/lib/http-errors.server";
import {
  claimTemplateValues,
  defaultCarrierRecipient,
  isValidEmail,
  MAX_EMAIL_BODY_LENGTH,
  MAX_EMAIL_SUBJECT_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  type EmailTemplateValues,
} from "@/lib/email-templates";

export interface EmailTemplate {
  id: string;
  key: string | null;
  name: string;
  subject: string;
  body: string;
}

export interface CarrierEmailDraft {
  templates: EmailTemplate[];
  values: EmailTemplateValues;
  /** claims.carrier_email, else adjuster_email, else "". */
  defaultTo: string;
}

const TEMPLATE_COLUMNS = "id, key, name, subject, body";

// Read with the caller's token: RLS lets only an agency_admin see templates.
export const fetchEmailTemplates = createServerFn({ method: "GET" })
  .middleware([requireAgencyAdmin])
  .handler(async ({ context }): Promise<EmailTemplate[]> => {
    const { data, error } = await context.supabase
      .from("email_templates")
      .select(TEMPLATE_COLUMNS)
      .order("sort_order")
      .order("created_at");
    if (error) throw new Error(`Couldn't load email templates: ${error.message}`);
    return data ?? [];
  });

export const fetchCarrierEmailDraft = createServerFn({ method: "GET" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(z.object({ claimId: z.string().uuid() })))
  .handler(async ({ data, context }): Promise<CarrierEmailDraft> => {
    const [claimRes, templatesRes, settingsRes] = await Promise.all([
      context.supabase
        .from("claims")
        .select(
          "claim_number, date_of_loss, adjuster_name, adjuster_email, carrier_email, policy_number, line_of_business, carrier, claimant_name, loss_location, description, clients(name, company_name)",
        )
        .eq("id", data.claimId)
        .maybeSingle(),
      context.supabase
        .from("email_templates")
        .select(TEMPLATE_COLUMNS)
        .order("sort_order")
        .order("created_at"),
      context.supabase
        .from("agency_settings")
        .select("broker_claims_email")
        .eq("id", 1)
        .maybeSingle(),
    ]);
    if (claimRes.error) throw new Error(`Couldn't load the claim: ${claimRes.error.message}`);
    if (!claimRes.data) throw new Error("Claim not found");
    if (templatesRes.error) {
      throw new Error(`Couldn't load email templates: ${templatesRes.error.message}`);
    }
    const claim = claimRes.data;
    const client = claim.clients as { name?: string | null; company_name?: string | null } | null;
    return {
      templates: templatesRes.data ?? [],
      values: claimTemplateValues(claim, {
        insured: client?.company_name || client?.name,
        brokerClaimsEmail: settingsRes.data?.broker_claims_email,
      }),
      defaultTo: defaultCarrierRecipient(claim),
    };
  });

const SendSchema = z.object({
  claimId: z.string().uuid(),
  templateId: z.string().uuid(),
  to: z
    .string()
    .trim()
    .min(1, "Enter the carrier's email address")
    .max(320)
    .refine(isValidEmail, "Enter a valid email address"),
  subject: z
    .string()
    .trim()
    .min(1, "Enter a subject")
    .max(MAX_EMAIL_SUBJECT_LENGTH, `Keep the subject under ${MAX_EMAIL_SUBJECT_LENGTH} characters`),
  body: z
    .string()
    .min(1)
    .max(MAX_EMAIL_BODY_LENGTH, `Keep the email under ${MAX_EMAIL_BODY_LENGTH} characters`)
    .refine((v) => v.trim().length > 0, "Write the email before sending"),
});

export const sendCarrierEmail = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(SendSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    return deliverCarrierEmail({ ...data, actorId: context.userId });
  });

const TemplateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Give the template a name")
    .max(MAX_TEMPLATE_NAME_LENGTH, `Keep the name under ${MAX_TEMPLATE_NAME_LENGTH} characters`),
  subject: z
    .string()
    .trim()
    .min(1, "Enter a subject")
    .max(MAX_EMAIL_SUBJECT_LENGTH, `Keep the subject under ${MAX_EMAIL_SUBJECT_LENGTH} characters`),
  body: z
    .string()
    .max(MAX_EMAIL_BODY_LENGTH, `Keep the email under ${MAX_EMAIL_BODY_LENGTH} characters`)
    .refine((v) => v.trim().length > 0, "Write the email body"),
});

// Edits an existing template (id given) or adds a new one. A new template has
// no key, so it never triggers the first-notice-of-loss behaviour.
export const saveEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(TemplateSchema))
  .handler(async ({ data, context }): Promise<EmailTemplate> => {
    const fields = {
      name: data.name,
      subject: data.subject,
      body: data.body,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
      const { data: row, error } = await context.supabase
        .from("email_templates")
        .update(fields)
        .eq("id", data.id)
        .select(TEMPLATE_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(`Couldn't save the template: ${error.message}`);
      if (!row) throw new Error("That email template no longer exists");
      return row;
    }
    const { data: last } = await context.supabase
      .from("email_templates")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: row, error } = await context.supabase
      .from("email_templates")
      .insert({ ...fields, sort_order: (last?.sort_order ?? 0) + 10 })
      .select(TEMPLATE_COLUMNS)
      .single();
    if (error) throw new Error(`Couldn't add the template: ${error.message}`);
    return row;
  });

// Only templates staff added can be removed; the seeded ones (with a key) stay
// so the app's first-notice-of-loss behaviour keeps working.
export const deleteEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(z.object({ id: z.string().uuid() })))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("email_templates")
      .delete()
      .eq("id", data.id)
      .is("key", null)
      .select("id");
    if (error) throw new Error(`Couldn't delete the template: ${error.message}`);
    if (!rows?.length) throw new Error("Built-in templates can't be deleted");
    return { ok: true };
  });
