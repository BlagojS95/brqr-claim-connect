// Server-only: loads who may see a claim and sends claim alert emails. Reads
// with the service role (user_roles, other people's client_users rows and
// auth.users aren't readable with the caller's token), so callers must have
// checked the caller's own access to the claim first, with the caller's token.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendViaResend } from "@/lib/claim-notifications.server";
import {
  alertPrefsFromRow,
  buildMessageEmail,
  chooseAlertRecipients,
  claimAudience,
  deliverAlerts,
  messageRecipients,
  type AlertClaim,
  type AlertDeliveryResult,
  type AlertEmail,
  type AlertEvent,
  type AlertPrefs,
  type AlertRecipientChoice,
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
 * Fix 48: who gets an email about an event on a claim, from each person's
 * watch and alert settings (see chooseAlertRecipients). `direct` are people
 * who are always told (someone @mentioned, the assigned staff member).
 */
export async function notificationRecipients(
  claimId: string,
  event: AlertEvent,
  opts: {
    actorId: string | null;
    direct?: readonly AlertRecipientChoice[];
    audience?: ClaimAudienceData;
  },
): Promise<{ audience: ClaimAudienceData; recipients: AlertRecipientChoice[] } | null> {
  const audience = opts.audience ?? (await loadClaimAudience(claimId));
  if (!audience) return null;
  const ids = audience.members.map((m) => m.userId);
  const [{ data: watches, error: watchError }, { data: prefRows, error: prefError }] =
    await Promise.all([
      supabaseAdmin.from("claim_watches").select("user_id").eq("claim_id", claimId),
      supabaseAdmin.from("user_notification_prefs").select("*").in("user_id", ids),
    ]);
  if (watchError) throw new Error(`Couldn't load watchers: ${watchError.message}`);
  if (prefError) throw new Error(`Couldn't load alert settings: ${prefError.message}`);
  const prefsByUser = new Map<string, AlertPrefs>(
    (prefRows ?? []).map((r) => [r.user_id, alertPrefsFromRow(r)]),
  );
  return {
    audience,
    recipients: chooseAlertRecipients({
      event,
      audience: audience.members,
      watcherIds: (watches ?? []).map((w) => w.user_id),
      prefsByUser,
      actorId: opts.actorId,
      direct: opts.direct,
    }),
  };
}

/** Emails one send budget can still cover (a carrier import touches many claims). */
export interface AlertBudget {
  remaining: number;
}

/**
 * Fix 48: emails the people who asked for alerts about an event on a claim
 * (status changes, document requests). Never throws: a failed alert must not
 * undo the change that caused it.
 */
export async function notifyClaimEvent(input: {
  claimId: string;
  event: Exclude<AlertEvent, "messages">;
  actorId: string | null;
  build: (claim: AlertClaim, reason: "watching" | "all") => AlertEmail;
  budget?: AlertBudget;
}): Promise<AlertDeliveryResult> {
  try {
    const found = await notificationRecipients(input.claimId, input.event, {
      actorId: input.actorId,
    });
    if (!found) return { sent: 0, failed: 0, skipped: 0 };
    let recipients = found.recipients;
    if (input.budget) {
      recipients = recipients.slice(0, Math.max(0, input.budget.remaining));
      input.budget.remaining -= recipients.length;
    }
    const people = await loadPeople(recipients.map((r) => r.userId));
    return await deliverAlerts(
      recipients.map((r) => ({ userId: r.userId, email: people.get(r.userId)?.email ?? null })),
      (r) => {
        const choice = recipients.find((c) => c.userId === r.userId);
        return input.build(found.audience.claim, choice?.reason === "all" ? "all" : "watching");
      },
      { send: sendViaResend, sleep },
    );
  } catch (err) {
    console.error("claim alert failed", err instanceof Error ? err.message : err);
    return { sent: 0, failed: 1, skipped: 0 };
  }
}

/**
 * Fix 47 + 48: emails the people mentioned in a new message, the claim's
 * assigned staff member, and anyone watching the claim (or asking for every
 * claim) who wants message alerts. Never the author. Never throws.
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
    const directIds = messageRecipients({
      audience: audience.members,
      mentionIds: input.mentionIds,
      assignedTo: audience.claim.assigned_to,
      authorId: input.authorId,
    });
    const direct: AlertRecipientChoice[] = directIds.map((userId) => ({
      userId,
      reason: input.mentionIds.includes(userId) ? "mentioned" : "assigned",
    }));
    const found = await notificationRecipients(audience.claim.id, "messages", {
      actorId: input.authorId,
      direct,
      audience,
    });
    const recipients = found?.recipients ?? [];
    const missing = recipients.map((r) => r.userId).filter((id) => !people.has(id));
    if (missing.length) for (const [id, p] of await loadPeople(missing)) people.set(id, p);
    const authorName = people.get(input.authorId)?.name ?? "Someone";
    return await deliverAlerts(
      recipients.map((r) => ({ userId: r.userId, email: people.get(r.userId)?.email ?? null })),
      (r) =>
        buildMessageEmail({
          claim: audience.claim,
          authorName,
          body: input.body,
          reason: recipients.find((c) => c.userId === r.userId)?.reason ?? "watching",
        }),
      { send: sendViaResend, sleep },
    );
  } catch (err) {
    console.error("message alert failed", err instanceof Error ? err.message : err);
    return { sent: 0, failed: 1, skipped: 0 };
  }
}
