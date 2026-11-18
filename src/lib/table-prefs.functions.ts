import { createServerFn } from "@tanstack/react-start";
import { parseInput } from "@/lib/http-errors.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ClaimsListPrefsSchema,
  parseClaimsListPrefs,
  type ClaimsListPrefs,
} from "@/lib/claims-table";

// Per-user table choices (fix 50). Both functions run with the caller's own
// token; user_table_prefs RLS limits each user to their own row.

export const fetchClaimsListPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClaimsListPrefs | null> => {
    const { data, error } = await context.supabase
      .from("user_table_prefs")
      .select("claims_list")
      .maybeSingle();
    if (error) throw new Error(error.message);
    // No row yet: the page keeps its defaults and the URL's own filters.
    if (!data) return null;
    return parseClaimsListPrefs(data.claims_list);
  });

export const saveClaimsListPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(ClaimsListPrefsSchema))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_table_prefs")
      .upsert(
        { user_id: context.userId, claims_list: data, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
