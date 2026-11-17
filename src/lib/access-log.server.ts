// Fix 51: writes the access log with the service role. Never awaited by the
// caller's response path: a failed or slow insert is logged to the console and
// never slows down or breaks the read or edit it records.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clampDetail, type AccessAction } from "@/lib/access-log";
import { loadDevVars } from "@/lib/load-dev-vars.server";

export interface AccessEvent {
  userId: string;
  action: AccessAction;
  /** The client the action concerns. Looked up from the claim when left out. */
  clientId?: string | null;
  claimId?: string | null;
  detail?: string | null;
  /**
   * Skip when the same user did the same thing to the same claim this many
   * minutes ago or less: re-opening a claim, or the page refetching it when
   * the tab regains focus, is one view rather than many.
   */
  dedupeMinutes?: number;
}

async function insertAccess(event: AccessEvent): Promise<void> {
  await loadDevVars();
  if (event.dedupeMinutes && event.claimId) {
    const since = new Date(Date.now() - event.dedupeMinutes * 60_000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("access_log")
      .select("id")
      .eq("user_id", event.userId)
      .eq("action", event.action)
      .eq("claim_id", event.claimId)
      .gte("created_at", since)
      .limit(1);
    if (recent?.length) return;
  }
  let clientId = event.clientId ?? null;
  if (!clientId && event.claimId) {
    const { data } = await supabaseAdmin
      .from("claims")
      .select("client_id")
      .eq("id", event.claimId)
      .maybeSingle();
    clientId = data?.client_id ?? null;
  }
  const { error } = await supabaseAdmin.from("access_log").insert({
    user_id: event.userId,
    client_id: clientId,
    action: event.action,
    claim_id: event.claimId ?? null,
    detail: clampDetail(event.detail),
  });
  if (error) throw new Error(error.message);
}

/** Fire and forget: returns at once; errors only reach the server log. */
export function logAccess(event: AccessEvent): void {
  insertAccess(event).catch((err: unknown) => {
    console.error(
      `[access-log] couldn't record ${event.action}:`,
      err instanceof Error ? err.message : err,
    );
  });
}

/** The company a client login belongs to, for sign-ins (null for agency staff). */
export async function clientIdOfUser(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("client_users")
    .select("client_id")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.client_id ?? null;
}
