import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadDevVars } from "@/lib/load-dev-vars.server";

await loadDevVars();

// Reset/delete take a raw auth user id, so make sure it really is a client's
// login before touching it — otherwise an admin could hit another admin's account.
async function requireClientLogin(userId: string) {
  const { data } = await supabaseAdmin.from("clients").select("id").eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("No client login found for this user.");
}

const CreateAccountSchema = z.object({
  clientId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(8),
});

export const createClientAccount = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator((input) => CreateAccountSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: client } = await context.supabase
      .from("clients")
      .select("id, user_id, name")
      .eq("id", data.clientId)
      .maybeSingle();

    if (!client) throw new Error("Client not found.");
    if (client.user_id) throw new Error("This client already has a login account.");

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { name: client.name },
    });

    if (createError || !created.user) {
      throw new Error(createError?.message ?? "Failed to create account.");
    }

    // The handle_new_user() trigger already gave this user the 'client' role.
    // Linking the existing clients row to it is what makes RLS show them their data.
    const { error: linkError } = await supabaseAdmin
      .from("clients")
      .update({ user_id: created.user.id, email: data.email })
      .eq("id", client.id);

    if (linkError) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw new Error(linkError.message);
    }

    return { userId: created.user.id };
  });

const ResetPasswordSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8),
});

export const resetClientPassword = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator((input) => ResetPasswordSchema.parse(input))
  .handler(async ({ data }) => {
    await requireClientLogin(data.userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: data.password });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const DeleteAccountSchema = z.object({ userId: z.string().uuid() });

// Removes the login only. The clients row keeps its policies and claims
// (clients.user_id is ON DELETE SET NULL), so a new login can be created later.
export const deleteClientAccount = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator((input) => DeleteAccountSchema.parse(input))
  .handler(async ({ data }) => {
    await requireClientLogin(data.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
