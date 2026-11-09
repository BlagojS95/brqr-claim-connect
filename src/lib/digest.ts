// Weekly email digest (fix 33): what changed on a user's claims this week and
// what is waiting on them. Pure, so it can be tested without Supabase or
// Resend; digest.server.ts loads the rows and sends the result.

import { CLAIM_ACTIVITY_KIND } from "@/lib/claim-activity";
import { CLAIM_STATUS, claimStatusLabel, type ClaimStatus } from "@/lib/claim-status";
import { formatDate, parseCalendarDate, todayIso } from "@/lib/dates";

export const DIGEST_SITE_URL = "https://www.claimsqr.com";
export const DIGEST_SETTINGS_URL = `${DIGEST_SITE_URL}/settings`;

/** How far back "this week" reaches. */
export const DIGEST_WINDOW_DAYS = 7;
/** A submitted claim still without a carrier claim number after this many days is flagged. */
export const AWAITING_CARRIER_NUMBER_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export const DIGEST_RUN_STATUS = {
  sent: "sent",
  skipped: "skipped",
  failed: "failed",
} as const;

export type DigestRunStatus = (typeof DIGEST_RUN_STATUS)[keyof typeof DIGEST_RUN_STATUS];

export const DIGEST_RUN_STATUSES: readonly DigestRunStatus[] = [
  DIGEST_RUN_STATUS.sent,
  DIGEST_RUN_STATUS.skipped,
  DIGEST_RUN_STATUS.failed,
];

export interface DigestClaim {
  id: string;
  client_id: string;
  claim_number: string | null;
  claimant_name: string | null;
  claim_type: string | null;
  status: ClaimStatus;
  is_notice_only: boolean;
  date_of_loss: string | null;
  created_at: string;
  /** Only shown when the digest covers more than one client (the admin test digest). */
  client_name?: string | null;
}

export interface DigestActivity {
  claim_id: string;
  kind: string;
  body: string;
  created_at: string;
}

export interface DigestDocumentRequest {
  claim_id: string;
  name: string;
  requested_at: string;
  fulfilled_at: string | null;
}

export interface DigestData {
  claims: DigestClaim[];
  activity: DigestActivity[];
  documentRequests: DigestDocumentRequest[];
}

/**
 * Keeps only rows that belong to one client: that client's claims, and
 * activity and document requests on those claims. The job reads with the
 * service role, which bypasses RLS, so this is the second line of defence
 * after the client_id filter on the queries themselves.
 */
export function scopeDigestDataToClient(clientId: string, data: DigestData): DigestData {
  const claims = data.claims.filter((c) => c.client_id === clientId);
  const ids = new Set(claims.map((c) => c.id));
  return {
    claims,
    activity: data.activity.filter((a) => ids.has(a.claim_id)),
    documentRequests: data.documentRequests.filter((r) => ids.has(r.claim_id)),
  };
}

export interface DigestStatusChange {
  claim: DigestClaim;
  body: string;
  at: string;
}

export interface DigestOpenRequest {
  claim: DigestClaim;
  name: string;
  requestedAt: string;
}

export interface DigestItems {
  newClaims: DigestClaim[];
  statusChanges: DigestStatusChange[];
  openRequests: DigestOpenRequest[];
  awaitingCarrierNumber: DigestClaim[];
}

function timeOf(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? NaN : t;
}

export function collectDigestItems(data: DigestData, now: Date): DigestItems {
  const since = now.getTime() - DIGEST_WINDOW_DAYS * DAY_MS;
  const byId = new Map(data.claims.map((c) => [c.id, c]));

  const newClaims = data.claims
    .filter((c) => timeOf(c.created_at) >= since)
    .sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at));

  const statusChanges: DigestStatusChange[] = [];
  for (const a of data.activity) {
    if (a.kind !== CLAIM_ACTIVITY_KIND.status_change) continue;
    if (!(timeOf(a.created_at) >= since)) continue;
    const claim = byId.get(a.claim_id);
    if (claim) statusChanges.push({ claim, body: a.body, at: a.created_at });
  }
  statusChanges.sort((a, b) => timeOf(b.at) - timeOf(a.at));

  const openRequests: DigestOpenRequest[] = [];
  for (const r of data.documentRequests) {
    if (r.fulfilled_at) continue;
    const claim = byId.get(r.claim_id);
    if (!claim || claim.status === CLAIM_STATUS.closed) continue;
    openRequests.push({ claim, name: r.name, requestedAt: r.requested_at });
  }
  openRequests.sort((a, b) => timeOf(a.requestedAt) - timeOf(b.requestedAt));

  const cutoff = now.getTime() - AWAITING_CARRIER_NUMBER_DAYS * DAY_MS;
  const awaitingCarrierNumber = data.claims
    .filter(
      (c) =>
        c.status === CLAIM_STATUS.submitted &&
        !c.is_notice_only &&
        !c.claim_number?.trim() &&
        timeOf(c.created_at) <= cutoff,
    )
    .sort((a, b) => timeOf(a.created_at) - timeOf(b.created_at));

  return { newClaims, statusChanges, openRequests, awaitingCarrierNumber };
}

export function digestItemCount(items: DigestItems): number {
  return (
    items.newClaims.length +
    items.statusChanges.length +
    items.openRequests.length +
    items.awaitingCarrierNumber.length
  );
}

export function escapeDigestHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function claimUrl(claimId: string): string {
  return `${DIGEST_SITE_URL}/claims/${encodeURIComponent(claimId)}`;
}

/** "Claim # 123 · Jane Doe · Auto" style label for one claim. */
export function claimLabel(claim: DigestClaim, showClientName = false): string {
  const parts: string[] = [];
  if (showClientName && claim.client_name?.trim()) parts.push(claim.client_name.trim());
  parts.push(
    claim.claim_number?.trim()
      ? `Claim # ${claim.claim_number.trim()}`
      : claim.is_notice_only
        ? "Incident notice"
        : "Claim (no carrier # yet)",
  );
  if (claim.claimant_name?.trim()) parts.push(claim.claimant_name.trim());
  if (claim.claim_type?.trim()) parts.push(claim.claim_type.trim());
  if (claim.date_of_loss) parts.push(`DOL ${formatDate(claim.date_of_loss)}`);
  return parts.join(" · ");
}

/** "YYYY-MM-DD" (agency calendar) of an ISO timestamp, shown as M/D/YYYY. */
function shortDate(iso: string): string {
  const t = timeOf(iso);
  return Number.isNaN(t) ? "" : formatDate(todayIso(new Date(t)));
}

/** Monday ("YYYY-MM-DD") of the week containing `now`, on the America/New_York calendar. */
export function weekStart(now: Date = new Date()): string {
  const today = parseCalendarDate(todayIso(now));
  if (!today) throw new Error("Couldn't read today's date");
  // Date.UTC on calendar parts is plain day arithmetic; no time zone shift.
  const utc = Date.UTC(today.year, today.month - 1, today.day);
  const daysSinceMonday = (new Date(utc).getUTCDay() + 6) % 7;
  const monday = new Date(utc - daysSinceMonday * DAY_MS);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const d = String(monday.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface DigestEmail {
  subject: string;
  html: string;
  text: string;
  itemCount: number;
}

export interface BuildDigestOptions {
  now: Date;
  /** Greeting name; left out when empty. */
  recipientName?: string | null;
  /** Prefix each claim with its client's name (the admin test digest covers every client). */
  showClientName?: boolean;
  /** Marks the subject and adds a note that this is a test. */
  isTest?: boolean;
}

interface Line {
  claimId: string;
  label: string;
  detail: string;
}

interface Section {
  title: string;
  lines: Line[];
}

const NAVY = "#0A2342";
const GOLD = "#C9A84C";
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The digest email for one user, or null when there is nothing to report
 * (the job then records the user as skipped and sends nothing).
 */
export function buildDigest(data: DigestData, options: BuildDigestOptions): DigestEmail | null {
  const items = collectDigestItems(data, options.now);
  const itemCount = digestItemCount(items);
  if (itemCount === 0) return null;
  const showClient = options.showClientName ?? false;

  const sections: Section[] = [
    {
      title: "Waiting on you: documents requested",
      lines: items.openRequests.map((r) => ({
        claimId: r.claim.id,
        label: claimLabel(r.claim, showClient),
        detail: `${r.name} (requested ${shortDate(r.requestedAt)})`,
      })),
    },
    {
      title: `Waiting on a carrier claim number (${AWAITING_CARRIER_NUMBER_DAYS}+ days)`,
      lines: items.awaitingCarrierNumber.map((c) => ({
        claimId: c.id,
        label: claimLabel(c, showClient),
        detail: `Reported ${shortDate(c.created_at)}`,
      })),
    },
    {
      title: "New this week",
      lines: items.newClaims.map((c) => ({
        claimId: c.id,
        label: claimLabel(c, showClient),
        detail: `${claimStatusLabel(c.status)} · reported ${shortDate(c.created_at)}`,
      })),
    },
    {
      title: "Status changes this week",
      lines: items.statusChanges.map((s) => ({
        claimId: s.claim.id,
        label: claimLabel(s.claim, showClient),
        detail: `${s.body} (${shortDate(s.at)})`,
      })),
    },
  ].filter((s) => s.lines.length > 0);

  const waiting = items.openRequests.length + items.awaitingCarrierNumber.length;
  const summaryParts = [
    items.newClaims.length ? plural(items.newClaims.length, "new claim", "new claims") : null,
    items.statusChanges.length
      ? plural(items.statusChanges.length, "status change", "status changes")
      : null,
    waiting ? plural(waiting, "item needing attention", "items needing attention") : null,
  ].filter((p): p is string => p !== null);
  const summary = summaryParts.join(", ");

  const subject = `${options.isTest ? "[Test] " : ""}Your weekly ClaimsQR update: ${summary}`;
  const greeting = options.recipientName?.trim()
    ? `Hello ${options.recipientName.trim()},`
    : "Hello,";
  const intro = `Here is what happened on your claims in the last ${DIGEST_WINDOW_DAYS} days.`;
  const testNote = options.isTest
    ? "This is a test digest sent only to you. It covers every client's claims."
    : null;
  const optOut = `You get this email because weekly digests are on for your ClaimsQR account. To stop them, turn off "Weekly digest" at ${DIGEST_SETTINGS_URL}`;

  const text = [
    greeting,
    "",
    ...(testNote ? [testNote, ""] : []),
    intro,
    "",
    ...sections.flatMap((s) => [
      s.title.toUpperCase(),
      ...s.lines.map((l) => `- ${l.label}: ${l.detail}\n  ${claimUrl(l.claimId)}`),
      "",
    ]),
    `Open ClaimsQR: ${DIGEST_SITE_URL}`,
    "",
    optOut,
  ].join("\n");

  const e = escapeDigestHtml;
  const sectionsHtml = sections
    .map(
      (s) => `
                <h2 style="color:${NAVY};font-size:14px;text-transform:uppercase;letter-spacing:0.04em;margin:24px 0 8px;">${e(s.title)}</h2>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${s.lines
                    .map(
                      (l) => `<tr><td style="padding:8px 0;border-top:1px solid #E0E5EB;">
                    <a href="${e(claimUrl(l.claimId))}" style="color:${NAVY};font-size:14px;font-weight:600;text-decoration:underline;">${e(l.label)}</a>
                    <div style="color:#5C646F;font-size:13px;margin-top:2px;">${e(l.detail)}</div>
                  </td></tr>`,
                    )
                    .join("")}
                </table>`,
    )
    .join("");

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
                <h1 style="color:${NAVY};font-size:20px;margin:0 0 12px;">Your weekly update</h1>
                ${testNote ? `<p style="background-color:#FFF8E6;border:1px solid ${GOLD};border-radius:6px;padding:10px 12px;color:#0A1628;font-size:13px;margin:0 0 16px;">${e(testNote)}</p>` : ""}
                <p style="color:#0A1628;font-size:14px;margin:0 0 4px;">${e(greeting)}</p>
                <p style="color:#0A1628;font-size:14px;margin:0;">${e(intro)} <b>${e(summary)}.</b></p>
                ${sectionsHtml}
                <p style="margin:28px 0 0;"><a href="${e(DIGEST_SITE_URL)}" style="display:inline-block;background-color:${NAVY};color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:6px;">Open ClaimsQR</a></p>
              </td>
            </tr>
            <tr>
              <td style="background-color:#EEF2F7;padding:16px 32px;text-align:center;">
                <span style="color:#5C646F;font-size:12px;">You get this email because weekly digests are on for your ClaimsQR account. <a href="${e(DIGEST_SETTINGS_URL)}" style="color:#5C646F;text-decoration:underline;">Turn off the weekly digest in Settings</a>.</span>
                <div style="color:#5C646F;font-size:12px;margin-top:6px;">&copy; BRQR Insurance Agency</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text, itemCount };
}

export type DigestRunCounts = Record<DigestRunStatus, number>;

export function countDigestRuns(rows: readonly { status: string }[]): DigestRunCounts {
  const counts: DigestRunCounts = { sent: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    if ((DIGEST_RUN_STATUSES as readonly string[]).includes(row.status)) {
      counts[row.status as DigestRunStatus] += 1;
    }
  }
  return counts;
}

/** Bearer-token check for the cron endpoint, without leaking the secret's length or content through timing. */
export function isAuthorizedCronRequest(
  authorization: string | null | undefined,
  secret: string,
): boolean {
  const expected = `Bearer ${secret}`;
  const given = authorization ?? "";
  const encoder = new TextEncoder();
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  // Compare over the expected length every time; a length mismatch still fails.
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}
