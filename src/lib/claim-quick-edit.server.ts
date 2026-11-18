// Server-only helpers for quick edit (fix 53): staff names for the activity
// text, and the check that an "Assigned to" id is really agency staff. Uses the
// service role because user_roles and auth.users of other people aren't
// readable with the caller's token; callers have already passed
// requireAgencyAdmin.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function isAgencyStaff(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "agency_admin")
    .maybeSingle();
  if (error) throw new Error(`Couldn't check the staff member: ${error.message}`);
  return !!data;
}

/** user id -> display name (their name, else their email). */
export async function staffNames(ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  await Promise.all(
    unique.map(async (id) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(id);
      const meta = data?.user?.user_metadata?.name;
      const name =
        typeof meta === "string" && meta.trim() ? meta.trim() : (data?.user?.email ?? null);
      names.set(id, name ?? "Former staff member");
    }),
  );
  return names;
}
