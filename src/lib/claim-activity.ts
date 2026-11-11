// Kinds and display rules for the claim activity log (claim_activity table,
// supabase/migrations/20261107000500_claim_activity.sql). Keep the kinds in
// step with the CHECK constraint there.

export const CLAIM_ACTIVITY_KINDS = [
  "created",
  "status_change",
  "document",
  "email",
  "follow_up",
  "note",
] as const;

export type ClaimActivityKind = (typeof CLAIM_ACTIVITY_KINDS)[number];

export const CLAIM_ACTIVITY_KIND = {
  created: "created",
  status_change: "status_change",
  document: "document",
  email: "email",
  follow_up: "follow_up",
  note: "note",
} as const satisfies Record<ClaimActivityKind, ClaimActivityKind>;

export const CLAIM_ACTIVITY_LABELS: Record<ClaimActivityKind, string> = {
  created: "Reported",
  status_change: "Status change",
  document: "Document",
  email: "Email",
  follow_up: "Follow-up",
  note: "Note",
};

export const MAX_ACTIVITY_NOTE_LENGTH = 2000;

export function claimActivityLabel(kind: string): string {
  return (CLAIM_ACTIVITY_KINDS as readonly string[]).includes(kind)
    ? CLAIM_ACTIVITY_LABELS[kind as ClaimActivityKind]
    : kind;
}

export interface ClaimActivityEntry {
  id: string;
  kind: string;
  body: string;
  created_at: string;
  author: string;
}

/** Newest first; ties broken by id so the order is stable. */
export function sortActivityNewestFirst<T extends { id: string; created_at: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const diff = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
    return b.id.localeCompare(a.id);
  });
}

export interface ActivityActor {
  isAgency: boolean;
  clientName?: string | null;
  email?: string | null;
  /** The person's own name, for companies with several logins (fix 32). */
  userName?: string | null;
}

/**
 * Who to show next to an entry. No actor (service role, import, backfill) is
 * "System"; agency staff show as the agency; a client shows as their client
 * name plus who at the company wrote it, falling back to their login email.
 */
export function activityAuthorLabel(
  actorId: string | null | undefined,
  actor: ActivityActor | undefined,
): string {
  if (!actorId) return "System";
  if (!actor) return "Unknown user";
  const email = actor.email?.trim();
  if (actor.isAgency) return email ? `BRQR Agency (${email})` : "BRQR Agency";
  const company = actor.clientName?.trim();
  const person = actor.userName?.trim() || email;
  if (company && person && person.toLowerCase() !== company.toLowerCase()) {
    return `${company} (${person})`;
  }
  return company || email || "Client";
}

/** Body for an activity row written when a notification outbox row finishes. */
export function notificationActivityBody(
  kind: string,
  status: "sent" | "failed",
  recipient: string,
): string {
  if (kind === "webhook") {
    return status === "sent"
      ? "Claim sent to the agency workflow"
      : "Agency workflow update failed";
  }
  return status === "sent"
    ? `Notification email sent to ${recipient}`
    : `Notification email to ${recipient} failed`;
}

/** Trims a note and checks it is something we'd store. */
export function normalizeActivityNote(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > MAX_ACTIVITY_NOTE_LENGTH) return null;
  return trimmed;
}

export function formatActivityTimestamp(iso: string, locale?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}
