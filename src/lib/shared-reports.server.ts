// Server-only helpers for report share links (fixes 44 and 46): who may manage
// a client's links, and storing a frozen report under a new random token.
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { getClientMembership, isAgencyAdmin } from "@/lib/client-access.server";
import { CLIENT_USER_ROLE } from "@/lib/client-users";
import { sharePath, type SharedReportKind } from "@/lib/shared-reports";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Only the hash is stored, so the table never holds a usable link. */
export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** True when the user may make and revoke share links for this client. */
export async function canManageShares(userId: string, clientId: string): Promise<boolean> {
  if (await isAgencyAdmin(userId)) return true;
  const member = await getClientMembership(userId);
  return member?.clientId === clientId && member.role === CLIENT_USER_ROLE.clientAdmin;
}

/** Stores a frozen report under a new token; returns the path to share. */
export async function storeSharedReport(input: {
  kind: SharedReportKind;
  clientId: string;
  title: string;
  snapshot: Json;
  days: number;
  createdBy: string;
}): Promise<{ id: string; path: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + input.days * DAY_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("shared_reports")
    .insert({
      token_hash: hashShareToken(token),
      kind: input.kind,
      client_id: input.clientId,
      title: input.title.slice(0, 200),
      snapshot: input.snapshot,
      created_by: input.createdBy,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Couldn't create the link: ${error.message}`);
  return { id: data.id, path: sharePath(token), expiresAt };
}
