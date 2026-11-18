// Claim email alerts: who gets an email when something happens on a claim, and
// what it says. Pure, so the rules can be tested without Supabase or Resend;
// claim-alerts.server.ts loads the people and sends.
//
// Fix 47: a new message emails everyone @mentioned in it plus the claim's
// assigned staff member, never its author.
import { CLIENT_USER_ROLE, type ClientUserRole } from "@/lib/client-users";
import { DIGEST_SETTINGS_URL, claimUrl, escapeDigestHtml } from "@/lib/digest";

/** Someone who may see a claim: all agency staff, and the client's logins that cover it. */
export interface AudienceMember {
  userId: string;
  isStaff: boolean;
}

export interface ClientLogin {
  user_id: string;
  role: ClientUserRole;
  location_ids: readonly string[] | null;
}

/**
 * Same rule as public.can_see_claim (fix 32): company-wide logins see every
 * claim of their client, location users only claims at one of their locations.
 * The client's first login (clients.user_id) counts as its admin.
 */
export function claimAudience(
  claim: { location_id: string | null },
  staffIds: readonly string[],
  clientLogins: readonly ClientLogin[],
  primaryUserId?: string | null,
): AudienceMember[] {
  const members = new Map<string, AudienceMember>();
  for (const id of staffIds) members.set(id, { userId: id, isStaff: true });
  const logins: ClientLogin[] = [...clientLogins];
  if (primaryUserId && !logins.some((l) => l.user_id === primaryUserId)) {
    logins.push({ user_id: primaryUserId, role: CLIENT_USER_ROLE.clientAdmin, location_ids: [] });
  }
  for (const login of logins) {
    if (members.has(login.user_id)) continue;
    const wide =
      login.role === CLIENT_USER_ROLE.clientAdmin || login.role === CLIENT_USER_ROLE.company;
    const atLocation =
      !!claim.location_id && (login.location_ids ?? []).includes(claim.location_id);
    if (wide || atLocation) members.set(login.user_id, { userId: login.user_id, isStaff: false });
  }
  return [...members.values()];
}

/**
 * Fix 47: who is emailed about a new message. Mentioned people and the
 * assigned staff member, only if they can see the claim, never the author,
 * each once.
 */
export function messageRecipients(input: {
  audience: readonly AudienceMember[];
  mentionIds: readonly string[];
  assignedTo: string | null;
  authorId: string | null;
}): string[] {
  const canSee = new Set(input.audience.map((m) => m.userId));
  const staff = new Set(input.audience.filter((m) => m.isStaff).map((m) => m.userId));
  const out: string[] = [];
  const add = (id: string | null) => {
    if (!id || id === input.authorId || !canSee.has(id) || out.includes(id)) return;
    out.push(id);
  };
  input.mentionIds.forEach(add);
  if (input.assignedTo && staff.has(input.assignedTo)) add(input.assignedTo);
  return out;
}

// ---------------------------------------------------------------------------
// Emails

export interface AlertClaim {
  id: string;
  claim_number: string | null;
  claim_type: string | null;
  client_name: string | null;
}

export interface AlertEmail {
  subject: string;
  html: string;
  text: string;
}

const NAVY = "#0A2342";
const GOLD = "#C9A84C";
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** "Auto claim 123-ABC · Acme Co" */
export function alertClaimLabel(claim: AlertClaim): string {
  const type = claim.claim_type?.trim();
  const number = claim.claim_number?.trim();
  const head = [type ? `${type} claim` : "Claim", number || "(number pending)"].join(" ");
  const client = claim.client_name?.trim();
  return client ? `${head} · ${client}` : head;
}

/** The shared layout of every claim alert email. */
export function renderAlertEmail(opts: {
  subject: string;
  heading: string;
  claim: AlertClaim;
  lines: string[];
  quote?: string | null;
  reason: string;
}): AlertEmail {
  const e = escapeDigestHtml;
  const url = claimUrl(opts.claim.id);
  const label = alertClaimLabel(opts.claim);
  const text = [
    opts.heading,
    label,
    "",
    ...opts.lines,
    ...(opts.quote ? ["", opts.quote] : []),
    "",
    `Open the claim: ${url}`,
    "",
    `${opts.reason} Change which emails you get in Settings: ${DIGEST_SETTINGS_URL}`,
  ].join("\n");

  const linesHtml = opts.lines
    .map((l) => `<p style="color:#0A1628;font-size:14px;margin:0 0 6px;">${e(l)}</p>`)
    .join("");
  const quoteHtml = opts.quote
    ? `<div style="border-left:3px solid ${GOLD};background-color:#F5F7FA;padding:10px 14px;margin:12px 0 0;color:#0A1628;font-size:14px;line-height:1.6;white-space:pre-wrap;">${e(opts.quote)}</div>`
    : "";

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#FAFCFE;font-family:${FONT_STACK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAFCFE;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:8px;overflow:hidden;border:1px solid #E0E5EB;">
            <tr>
              <td style="background-color:${NAVY};padding:24px 32px;">
                <span style="color:#F9FCFF;font-size:20px;font-weight:700;">ClaimsQR</span>
                <div style="height:3px;width:48px;background-color:${GOLD};margin-top:10px;"></div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="color:${NAVY};font-size:20px;margin:0 0 6px;">${e(opts.heading)}</h1>
                <p style="color:#5C646F;font-size:13px;margin:0 0 16px;">${e(label)}</p>
                ${linesHtml}
                ${quoteHtml}
                <p style="margin:24px 0 0;"><a href="${e(url)}" style="display:inline-block;background-color:${NAVY};color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:6px;">Open the claim</a></p>
              </td>
            </tr>
            <tr>
              <td style="background-color:#EEF2F7;padding:16px 32px;text-align:center;">
                <span style="color:#5C646F;font-size:12px;">${e(opts.reason)} <a href="${e(DIGEST_SETTINGS_URL)}" style="color:#5C646F;text-decoration:underline;">Change which emails you get in Settings</a>.</span>
                <div style="color:#5C646F;font-size:12px;margin-top:6px;">&copy; BRQR Insurance Agency</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: opts.subject, html, text };
}

/** Why someone got a message email; shown in its footer. */
export type MessageEmailReason = "mentioned" | "assigned" | "watching" | "all";

const MESSAGE_REASON_TEXT: Record<MessageEmailReason, string> = {
  mentioned: "You get this email because you were mentioned in this message.",
  assigned: "You get this email because this claim is assigned to you.",
  watching: "You get this email because you watch this claim.",
  all: "You get this email because you asked for emails about new messages on every claim.",
};

export function buildMessageEmail(opts: {
  claim: AlertClaim;
  authorName: string;
  body: string;
  reason: MessageEmailReason;
}): AlertEmail {
  const number = opts.claim.claim_number?.trim();
  const mentioned = opts.reason === "mentioned";
  return renderAlertEmail({
    subject: `${mentioned ? `${opts.authorName} mentioned you` : `New message from ${opts.authorName}`} on ${number ? `claim ${number}` : "a claim"} | ClaimsQR`,
    heading: mentioned ? "You were mentioned in a message" : "New message on a claim",
    claim: opts.claim,
    lines: [`${opts.authorName} wrote:`],
    quote: opts.body,
    reason: MESSAGE_REASON_TEXT[opts.reason],
  });
}

// ---------------------------------------------------------------------------
// Delivery

export interface AlertRecipient {
  userId: string;
  email: string | null;
}

export interface AlertDeliveryResult {
  sent: number;
  failed: number;
  skipped: number;
}

/** Resend's default limit is 2 requests a second; keep sends below it. */
export const ALERT_SEND_SPACING_MS = 600;

/**
 * Sends one email per recipient. A failed send (or a login without an email
 * address) is counted and logged, never thrown: an alert must not undo or
 * fail whatever triggered it.
 */
export async function deliverAlerts(
  recipients: readonly AlertRecipient[],
  build: (recipient: AlertRecipient) => AlertEmail,
  deps: {
    send: (subject: string, html: string, options: { to: string; text: string }) => Promise<void>;
    sleep?: (ms: number) => Promise<void>;
    log?: (message: string, detail: unknown) => void;
  },
): Promise<AlertDeliveryResult> {
  const result: AlertDeliveryResult = { sent: 0, failed: 0, skipped: 0 };
  const log = deps.log ?? ((message, detail) => console.error(message, detail));
  let sentBefore = false;
  for (const recipient of recipients) {
    const to = recipient.email?.trim();
    if (!to) {
      result.skipped++;
      continue;
    }
    try {
      if (sentBefore && deps.sleep) await deps.sleep(ALERT_SEND_SPACING_MS);
      sentBefore = true;
      const email = build(recipient);
      await deps.send(email.subject, email.html, { to, text: email.text });
      result.sent++;
    } catch (err) {
      result.failed++;
      log("claim alert email failed", {
        userId: recipient.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Watch and alert preferences (fix 48)

/** The kinds of event a user can ask to be emailed about. */
export const ALERT_EVENTS = ["status", "messages", "documents"] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

export const ALERT_EVENT_LABELS: Record<AlertEvent, string> = {
  status: "Status changes",
  messages: "New messages",
  documents: "Document requests",
};

/** For one kind of event: emails for claims the user watches, and for every claim they can see. */
export interface EventPref {
  watched: boolean;
  all: boolean;
}
export type AlertPrefs = Record<AlertEvent, EventPref>;

/** What a user without a saved row gets: watched claims on, all claims off. */
export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  status: { watched: true, all: false },
  messages: { watched: true, all: false },
  documents: { watched: true, all: false },
};

/** user_notification_prefs columns, per event. */
export const ALERT_PREF_COLUMNS = {
  status: { watched: "status_watched", all: "status_all" },
  messages: { watched: "messages_watched", all: "messages_all" },
  documents: { watched: "documents_watched", all: "documents_all" },
} as const;

export type AlertPrefRow = Readonly<Record<string, unknown>>;

const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

/** Prefs from a user_notification_prefs row (missing row or column = default). */
export function alertPrefsFromRow(row: AlertPrefRow | null | undefined): AlertPrefs {
  const out = {} as AlertPrefs;
  for (const event of ALERT_EVENTS) {
    const cols = ALERT_PREF_COLUMNS[event];
    out[event] = {
      watched: flag(row?.[cols.watched], DEFAULT_ALERT_PREFS[event].watched),
      all: flag(row?.[cols.all], DEFAULT_ALERT_PREFS[event].all),
    };
  }
  return out;
}

export type AlertReason = "mentioned" | "assigned" | "watching" | "all";

export interface AlertRecipientChoice {
  userId: string;
  reason: AlertReason;
}

/**
 * Fix 48: who is emailed about an event on a claim. Only people who can see
 * the claim, never the person who caused the event, each once. Direct
 * recipients (someone @mentioned, the assigned staff member) are always
 * emailed. Everyone else needs the event's "watched claims" switch on while
 * they watch the claim, or its "all claims" switch on.
 */
export function chooseAlertRecipients(input: {
  event: AlertEvent;
  audience: readonly AudienceMember[];
  watcherIds: readonly string[];
  prefsByUser: ReadonlyMap<string, AlertPrefs>;
  actorId: string | null;
  direct?: readonly AlertRecipientChoice[];
}): AlertRecipientChoice[] {
  const canSee = new Set(input.audience.map((m) => m.userId));
  const watchers = new Set(input.watcherIds);
  const out = new Map<string, AlertRecipientChoice>();
  const add = (choice: AlertRecipientChoice) => {
    if (choice.userId === input.actorId || !canSee.has(choice.userId)) return;
    if (!out.has(choice.userId)) out.set(choice.userId, choice);
  };
  for (const d of input.direct ?? []) add(d);
  for (const member of input.audience) {
    const pref =
      input.prefsByUser.get(member.userId)?.[input.event] ?? DEFAULT_ALERT_PREFS[input.event];
    if (pref.all) add({ userId: member.userId, reason: "all" });
    else if (pref.watched && watchers.has(member.userId))
      add({ userId: member.userId, reason: "watching" });
  }
  return [...out.values()];
}

const EVENT_REASON_TEXT: Record<
  Exclude<AlertEvent, "messages">,
  Record<"watching" | "all", string>
> = {
  status: {
    watching: "You get this email because you watch this claim.",
    all: "You get this email because you asked for emails about status changes on every claim.",
  },
  documents: {
    watching: "You get this email because you watch this claim.",
    all: "You get this email because you asked for emails about document requests on every claim.",
  },
};

export function buildStatusChangeEmail(opts: {
  claim: AlertClaim;
  from: string;
  to: string;
  reason: "watching" | "all";
}): AlertEmail {
  const number = opts.claim.claim_number?.trim();
  return renderAlertEmail({
    subject: `Status changed to ${opts.to} on ${number ? `claim ${number}` : "a claim"} | ClaimsQR`,
    heading: "A claim's status changed",
    claim: opts.claim,
    lines: [`Status: ${opts.from} to ${opts.to}`],
    reason: EVENT_REASON_TEXT.status[opts.reason],
  });
}

export function buildDocumentRequestEmail(opts: {
  claim: AlertClaim;
  name: string;
  note: string | null;
  reason: "watching" | "all";
}): AlertEmail {
  const number = opts.claim.claim_number?.trim();
  return renderAlertEmail({
    subject: `Document requested on ${number ? `claim ${number}` : "a claim"} | ClaimsQR`,
    heading: "A document was requested",
    claim: opts.claim,
    lines: [`Requested: ${opts.name}`],
    quote: opts.note,
    reason: EVENT_REASON_TEXT.documents[opts.reason],
  });
}

/** The status change among a claim's field changes (labels as shown to staff), if any. */
export function statusChangeOf(
  changes: readonly { field: string; from: string; to: string }[],
): { from: string; to: string } | null {
  const change = changes.find((c) => c.field === "status");
  return change && change.from !== change.to ? { from: change.from, to: change.to } : null;
}
