// Fix 51: the browser's side of two-step sign-in. What to show comes from
// Supabase Auth (assurance level) and fetchMfaStatus; the server enforces it
// on every call regardless (src/lib/mfa.server.ts) and the database does too.
import { supabase } from "@/integrations/supabase/client";
import { fetchMfaStatus } from "@/lib/security.functions";
import { signInStep, type SignInStep } from "@/lib/mfa";

// "done" is remembered for a minute per user so page changes don't each ask
// the server; the login screen always asks fresh.
const DONE_CACHE_MS = 60_000;
let doneFor: { userId: string; at: number } | null = null;

/** What this session still has to do before it may enter the app. */
export async function getSignInStep(opts: { fresh?: boolean } = {}): Promise<SignInStep> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id ?? null;
  if (
    !opts.fresh &&
    userId &&
    doneFor?.userId === userId &&
    Date.now() - doneFor.at < DONE_CACHE_MS
  ) {
    return "done";
  }
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return "done";
  let required = false;
  // Someone who has entered their code this session needs no lookup.
  if (data.currentLevel !== "aal2" && data.nextLevel !== "aal2") {
    try {
      required = (await fetchMfaStatus()).required;
    } catch {
      // The server refuses when it can't tell; it will refuse the pages too.
      required = false;
    }
  }
  const step = signInStep({
    currentLevel: data.currentLevel,
    nextLevel: data.nextLevel,
    required,
  });
  doneFor = step === "done" && userId ? { userId, at: Date.now() } : null;
  return step;
}
