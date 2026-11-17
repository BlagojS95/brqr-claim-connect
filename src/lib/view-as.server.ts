// View as client (fix 55), server side. See src/lib/view-as.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { forbidden } from "@/lib/http-errors.server";
import { VIEW_AS_READ_ONLY_MESSAGE, allowedWhileViewing } from "@/lib/view-as";

// PostgREST "function not found" / Postgres undefined_function: the migration
// isn't applied yet, so there is no session table either and nobody is viewing.
const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"]);

/**
 * The client this user is viewing as right now, or null. Asked of the database
 * with the caller's own token (public.viewing_as_client only answers for the
 * caller's own id), never taken from the browser.
 */
export async function viewingClientFor(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("viewing_as_client", { _uid: userId });
  if (error) {
    if (error.code && MISSING_FUNCTION_CODES.has(error.code)) return null;
    // Fail closed: if we can't tell, don't run the function.
    throw new Error(`Couldn't check the view-as-client session: ${error.message}`);
  }
  return data ?? null;
}

/**
 * Called by requireSupabaseAuth for every server function. Returns the viewed
 * client id (null when not viewing) and answers 403 for every function that
 * isn't on the read-only list while a session is open.
 */
export async function guardViewSession(
  supabase: SupabaseClient<Database>,
  userId: string,
  fnName: string | undefined,
): Promise<string | null> {
  const viewingClientId = await viewingClientFor(supabase, userId);
  if (viewingClientId && !allowedWhileViewing(fnName)) {
    forbidden(VIEW_AS_READ_ONLY_MESSAGE);
  }
  return viewingClientId;
}

/**
 * For functions that take a client id from the browser: while viewing, only
 * the viewed client is allowed. RLS would hide other clients' rows anyway; this
 * gives a clear 403 instead of an empty result.
 */
export function assertViewScope(viewingClientId: string | null, clientId: string): void {
  if (viewingClientId && clientId !== viewingClientId) {
    forbidden("While viewing as a client you can only see that client");
  }
}
