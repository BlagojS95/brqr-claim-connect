import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import type { Database } from "@/integrations/supabase/types";
import { loadDevVars } from "@/lib/load-dev-vars.server";

await loadDevVars();

export const fetchClientAccounts = createServerFn({ method: "GET" })
  .middleware([requireAgencyAdmin])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("clients")
      .select("id, user_id, email, ams360_id")
      .not("user_id", "is", null);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const CreateAccountSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  company_name: z.string().nullable(),
  ams360_id: z.string().min(1),
});

export const createClientAccount = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator((input) => CreateAccountSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("clients")
      .select("id")
      .eq("ams360_id", data.ams360_id)
      .not("user_id", "is", null)
      .maybeSingle();

    if (existing) {
      throw new Error("This client already has a login account.");
    }

    // No service-role key available (Lovable Cloud doesn't expose the raw Supabase
    // dashboard), so we can't use the admin.createUser API. Instead, sign this account
    // up the same way self-signup does, just from a throwaway client instance that never
    // touches the browser's session/localStorage — so the admin stays logged in as
    // themselves the whole time.
    const signupClient = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: created, error: signUpError } = await signupClient.auth.signUp({
      email: data.email,
      password: data.password,
      options: { data: { name: data.name } },
    });

    if (signUpError || !created.user) {
      throw new Error(signUpError?.message ?? "Failed to create account.");
    }

    // The handle_new_user() trigger already inserted a user_roles('client') row
    // and a blank clients row for this user_id — fill it in with the real details.
    // context.supabase carries the calling admin's own auth token, and the "admin
    // manages clients" RLS policy allows this update.
    const { error: updateError } = await context.supabase
      .from("clients")
      .update({
        name: data.name,
        company_name: data.company_name,
        email: data.email,
        ams360_id: data.ams360_id,
      })
      .eq("user_id", created.user.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return { userId: created.user.id };
  });
