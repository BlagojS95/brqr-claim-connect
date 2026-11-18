// Fix 51: server side of "require two-step sign-in". See src/lib/mfa.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { forbidden } from "@/lib/http-errors.server";
import { MFA_REQUIRED_MESSAGE, mfaBlocks } from "@/lib/mfa";

// PostgREST "function not found" / Postgres undefined_function: the migration
// isn't applied yet, so no client can require it.
const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"]);

/** Whether this user's company requires two-step sign-in. Asked with the caller's token. */
export async function mfaRequiredFor(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("mfa_required", { _uid: userId });
  if (error) {
    if (error.code && MISSING_FUNCTION_CODES.has(error.code)) return false;
    // Fail closed: if we can't tell, don't run the function.
    throw new Error(`Couldn't check two-step sign-in: ${error.message}`);
  }
  return data === true;
}

/**
 * Called by requireSupabaseAuth for every server function: 403 when the
 * caller's company requires two-step sign-in and this session hasn't passed
 * it (JWT aal claim), except for the few functions the sign-in screens need.
 * The aal claim comes from the verified JWT, never from the browser.
 */
export async function guardMfa(
  supabase: SupabaseClient<Database>,
  userId: string,
  aal: unknown,
  fnName: string | undefined,
): Promise<void> {
  if (!mfaBlocks({ aal, fnName })) return;
  if (await mfaRequiredFor(supabase, userId)) forbidden(MFA_REQUIRED_MESSAGE);
}
