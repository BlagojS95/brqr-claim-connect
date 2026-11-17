// Server-only: loads who may see a claim and sends claim alert emails. Reads
// with the service role (user_roles, other people's client_users rows and
// auth.users aren't readable with the caller's token), so callers must have
// checked the caller's own access to the claim first, with the caller's token.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendViaResend } from "@/lib/claim-notifications.server";
import {
  buildMessageEmail,
  claimAudience,
  deliverAlerts,
  messageRecipients,
  type AlertClaim,
  type AlertDeliveryResult,
  type AudienceMember,
} from "@/lib/claim-alerts";

export interface ClaimAudienceData {
  claim: AlertClaim & { client_id: string; location_id: string | null; assigned_to: string | null };
  members: AudienceMember[];
}

export interface Person {
  name: string;
  email: string | null;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** The claim and everyone who may see it (agency staff and the client's logins that cover it). */
export async function loadClaimAudience(claimId: string): Promise<ClaimAudienceData | null> {
  const { data: claim, error } = await supabaseAdmin
    .from("claims")
    .select(
      "id, client_id, location_id, assigned_to, claim_number, claim_type, clients(name, company_name, user_id)",
    )
    .eq("id", claimId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't load the claim: ${error.message}`);
  if (!claim) return null;

  const [{ data: staff, error: staffError }, { data: logins, error: loginsError }] =
    await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id").eq("role", "agency_admin"),
      supabaseAdmin
        .from("client_users")
        .select("user_id, role, location_ids")
        .eq("client_id", claim.client_id),
    ]);
  if (staffError) throw new Error(`Couldn't load agency staff: ${staffError.message}`);
  if (loginsError) throw new Error(`Couldn't load client logins: ${loginsError.message}`);

  const { clients, ...rest } = claim;
  return {
    claim: { ...rest, client_name: clients?.company_name || clients?.name || null },
    members: claimAudience(
      claim,
      (staff ?? []).map((s) => s.user_id),
      logins ?? [],
      clients?.user_id ?? null,
    ),
  };
}

/** Display name and email of each login: their name, else the part of the email before "@". */
export async function loadPeople(ids: readonly (string | null)[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const people = new Map<string, Person>();
  await Promise.all(
    unique.map(async (id) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(id);
      const user = data?.user;
      if (!user) return;
      const meta = user.user_metadata?.name;
      const email = user.email?.trim() || null;
      const name =
        typeof meta === "string" && meta.trim() ? meta.trim() : (email?.split("@")[0] ?? "User");
      people.set(id, { name, email });
    }),
  );
  return people;
}

/**
 * Fix 47: emails the people mentioned in a new message and the claim's
 * assigned staff member (never the author). Never throws.
 */
export async function notifyNewMessage(input: {
  audience: ClaimAudienceData;
  people: Map<string, Person>;
  authorId: string;
  body: string;
  mentionIds: readonly string[];
}): Promise<AlertDeliveryResult> {
  const { audience, people } = input;
  try {
    const ids = messageRecipients({
      audience: audience.members,
      mentionIds: input.mentionIds,
      assignedTo: audience.claim.assigned_to,
      authorId: input.authorId,
    });
    const missing = ids.filter((id) => !people.has(id));
    if (missing.length) for (const [id, p] of await loadPeople(missing)) people.set(id, p);
    const authorName = people.get(input.authorId)?.name ?? "Someone";
    return await deliverAlerts(
      ids.map((userId) => ({ userId, email: people.get(userId)?.email ?? null })),
      (r) =>
        buildMessageEmail({
          claim: audience.claim,
          authorName,
          body: input.body,
          reason: input.mentionIds.includes(r.userId) ? "mentioned" : "assigned",
        }),
      { send: sendViaResend, sleep },
    );
  } catch (err) {
    console.error("message alert failed", err instanceof Error ? err.message : err);
    return { sent: 0, failed: 1, skipped: 0 };
  }
}
