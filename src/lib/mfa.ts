// Fix 51: two-step sign-in (TOTP authenticator app, Supabase Auth MFA).
//
// A client can require it (clients.require_mfa). For such a client's logins,
// a session that hasn't passed the second step ("aal1") is refused by the
// server (requireSupabaseAuth -> mfa.server.ts) and sees no rows in the
// database (the 20261117000500 migration). The browser steps in login.tsx and
// the /_app guard only decide what to show. Agency staff are never required to.

export const MFA_REQUIRED_MESSAGE = "Two-step sign-in required";

/**
 * Server functions a login may call before passing the second step: only what
 * the sign-in and enrolment screens need. Enrolling and verifying themselves
 * go straight to Supabase Auth from the browser, and signing out needs no
 * server function. Every name here must also be in SERVER_FN_ACCESS.
 */
export const MFA_EXEMPT_SERVER_FNS: ReadonlySet<string> = new Set(["fetchMfaStatus"]);

export function mfaExempt(fnName: string | undefined | null): boolean {
  return !!fnName && MFA_EXEMPT_SERVER_FNS.has(fnName);
}

export type AuthLevel = string | null | undefined;

/** Whether the server must refuse this call. `required` is only asked for when it matters. */
export function mfaBlocks(opts: { aal: unknown; fnName: string | undefined | null }): boolean {
  return opts.aal !== "aal2" && !mfaExempt(opts.fnName);
}

export type SignInStep = "verify" | "enroll" | "done";

/**
 * What a signed-in login still has to do before entering the app:
 * - verify: has an authenticator app, hasn't entered its code this session;
 * - enroll: its company requires two-step sign-in and it has no app yet;
 * - done.
 * Someone who set up an app always enters the code, required or not.
 */
export function signInStep(opts: {
  currentLevel: AuthLevel;
  nextLevel: AuthLevel;
  required: boolean;
}): SignInStep {
  if (opts.currentLevel === "aal2") return "done";
  if (opts.nextLevel === "aal2") return "verify";
  return opts.required ? "enroll" : "done";
}

/** Six digits, spaces ignored (authenticator apps show "123 456"). */
export function normalizeTotpCode(input: string): string | null {
  const digits = input.replace(/\s+/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** The secret in groups of four, easier to type into an app by hand. */
export function formatTotpSecret(secret: string): string {
  return (
    secret
      .replace(/\s+/g, "")
      .match(/.{1,4}/g)
      ?.join(" ") ?? ""
  );
}

export interface MfaStatus {
  /** The caller's company requires two-step sign-in (always false for agency staff). */
  required: boolean;
}

export interface ClientMfaSetting {
  clientId: string;
  clientName: string;
  requireMfa: boolean;
}

export interface SecuritySettings {
  /** "client": the caller's own company only; "agency": every client. */
  manage: "client" | "agency" | null;
  clients: ClientMfaSetting[];
}
