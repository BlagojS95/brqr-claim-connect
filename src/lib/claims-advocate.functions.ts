import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseInput } from "@/lib/http-errors.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import {
  AdvocateContactSchema,
  AdvocateDefaultsSchema,
  resolveClaimsAdvocate,
  type AdvocateContact,
  type ClaimsAdvocateInfo,
} from "@/lib/claims-advocate";

// Claims advocate (fix 59). Every query runs with the caller's own token:
// a client member can read only its own clients row (RLS "client sees self"),
// agency_settings is readable by any signed-in user, and only an agency_admin
// can write either (RLS, plus requireAgencyAdmin on the write functions).

const SETTINGS_COLUMNS =
  "default_advocate_name, default_advocate_phone, default_advocate_email, after_hours_claims_phone";

/** The caller's claims advocate and after-hours number, for the Help block. */
export const fetchClaimsAdvocate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(z.object({ clientId: z.string().uuid() })))
  .handler(async ({ data, context }): Promise<ClaimsAdvocateInfo> => {
    // Viewing as a client (fix 55): always that client, whatever was asked.
    const clientId = context.viewingClientId ?? data.clientId;
    const [client, settings] = await Promise.all([
      context.supabase
        .from("clients")
        .select("advocate_name, advocate_phone, advocate_email")
        .eq("id", clientId)
        .maybeSingle(),
      context.supabase.from("agency_settings").select(SETTINGS_COLUMNS).eq("id", 1).maybeSingle(),
    ]);
    if (client.error) throw new Error(client.error.message);
    if (settings.error) throw new Error(settings.error.message);
    return resolveClaimsAdvocate(client.data, settings.data);
  });

/** One client's own advocate (not the default), for the edit dialog on /admin. */
export const fetchClientAdvocate = createServerFn({ method: "GET" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(z.object({ clientId: z.string().uuid() })))
  .handler(async ({ data, context }): Promise<AdvocateContact> => {
    const { data: row, error } = await context.supabase
      .from("clients")
      .select("advocate_name, advocate_phone, advocate_email")
      .eq("id", data.clientId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Client not found");
    return { name: row.advocate_name, phone: row.advocate_phone, email: row.advocate_email };
  });

export const updateClientAdvocate = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(
    parseInput(z.object({ clientId: z.string().uuid(), advocate: AdvocateContactSchema })),
  )
  .handler(async ({ data, context }): Promise<AdvocateContact> => {
    const { data: rows, error } = await context.supabase
      .from("clients")
      .update({
        advocate_name: data.advocate.name,
        advocate_phone: data.advocate.phone,
        advocate_email: data.advocate.email,
      })
      .eq("id", data.clientId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Client not found");
    return data.advocate;
  });

export interface AdvocateDefaults {
  advocate: AdvocateContact;
  afterHoursPhone: string | null;
}

/** The agency default advocate and after-hours number, for Settings. */
export const fetchAdvocateDefaults = createServerFn({ method: "GET" })
  .middleware([requireAgencyAdmin])
  .handler(async ({ context }): Promise<AdvocateDefaults> => {
    const { data: row, error } = await context.supabase
      .from("agency_settings")
      .select(SETTINGS_COLUMNS)
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      advocate: {
        name: row?.default_advocate_name ?? null,
        phone: row?.default_advocate_phone ?? null,
        email: row?.default_advocate_email ?? null,
      },
      afterHoursPhone: row?.after_hours_claims_phone ?? null,
    };
  });

export const updateAdvocateDefaults = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(AdvocateDefaultsSchema))
  .handler(async ({ data, context }): Promise<AdvocateDefaults> => {
    const { data: rows, error } = await context.supabase
      .from("agency_settings")
      .update({
        default_advocate_name: data.advocate.name,
        default_advocate_phone: data.advocate.phone,
        default_advocate_email: data.advocate.email,
        after_hours_claims_phone: data.afterHoursPhone,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)
      .select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Agency settings row not found");
    return data;
  });
