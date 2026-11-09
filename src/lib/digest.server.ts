// Server-only: the weekly digest job (fix 33). Runs from the cron endpoint
// with no signed-in user, so it reads with the service role, which bypasses
// RLS. Every query for a client's digest is therefore filtered by that
// client's id here, and the rows go through scopeDigestDataToClient as well.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendViaResend } from "@/lib/claim-notifications.server";
import { loadDevVars } from "@/lib/load-dev-vars.server";
import { fetchAll } from "@/lib/fetch-all";
import {
  buildDigest,
  DIGEST_RUN_STATUS,
  DIGEST_WINDOW_DAYS,
  scopeDigestDataToClient,
  weekStart,
  type DigestActivity,
  type DigestClaim,
  type DigestData,
  type DigestDocumentRequest,
  type DigestRunStatus,
} from "@/lib/digest";

const CLAIM_COLUMNS =
  "id, client_id, claim_number, claimant_name, claim_type, status, is_notice_only, date_of_loss, created_at";

// Resend's default limit is 2 requests a second; keep sends below it.
const SEND_SPACING_MS = 600;

function sinceIso(now: Date): string {
  return new Date(now.getTime() - DIGEST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One client's claims, this week's activity on them, and their document requests. */
export async function loadClientDigestData(clientId: string, now: Date): Promise<DigestData> {
  const claims = await fetchAll<DigestClaim>((from, to) =>
    supabaseAdmin
      .from("claims")
      .select(CLAIM_COLUMNS)
      .eq("client_id", clientId)
      .order("id")
      .range(from, to),
  );

  const activity = await fetchAll<DigestActivity>((from, to) =>
    supabaseAdmin
      .from("claim_activity")
      .select("claim_id, kind, body, created_at, claims!inner(client_id)")
      .eq("claims.client_id", clientId)
      .gte("created_at", sinceIso(now))
      .order("id")
      .range(from, to),
  );

  const documentRequests = await fetchAll<DigestDocumentRequest>((from, to) =>
    supabaseAdmin
      .from("claim_document_requests")
      .select("claim_id, name, requested_at, fulfilled_at, claims!inner(client_id)")
      .eq("claims.client_id", clientId)
      .is("fulfilled_at", null)
      .order("id")
      .range(from, to),
  );

  return scopeDigestDataToClient(clientId, { claims, activity, documentRequests });
}

/** Every client's rows: what an agency admin sees. Only for the admin's own test digest. */
async function loadAgencyDigestData(now: Date): Promise<DigestData> {
  const rows = await fetchAll<
    DigestClaim & { clients: { name: string; company_name: string | null } | null }
  >((from, to) =>
    supabaseAdmin
      .from("claims")
      .select(`${CLAIM_COLUMNS}, clients(name, company_name)`)
      .order("id")
      .range(from, to),
  );
  const claims = rows.map(({ clients, ...claim }) => ({
    ...claim,
    client_name: clients?.company_name || clients?.name || null,
  }));

  const activity = await fetchAll<DigestActivity>((from, to) =>
    supabaseAdmin
      .from("claim_activity")
      .select("claim_id, kind, body, created_at")
      .gte("created_at", sinceIso(now))
      .order("id")
      .range(from, to),
  );

  const documentRequests = await fetchAll<DigestDocumentRequest>((from, to) =>
    supabaseAdmin
      .from("claim_document_requests")
      .select("claim_id, name, requested_at, fulfilled_at")
      .is("fulfilled_at", null)
      .order("id")
      .range(from, to),
  );

  return { claims, activity, documentRequests };
}

async function userEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error) throw new Error(`Couldn't load the login: ${error.message}`);
  return data.user?.email?.trim() || null;
}

export async function isWeeklyDigestEnabled(): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("agency_settings")
    .select("weekly_digest_enabled")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read agency settings: ${error.message}`);
  return data?.weekly_digest_enabled === true;
}

export interface WeeklyDigestResult {
  enabled: boolean;
  weekStart: string;
  sent: number;
  skipped: number;
  failed: number;
  alreadyDone: number;
  optedOut: number;
}

/**
 * Sends this week's digest to every client login that hasn't opted out and
 * hasn't had one this week. Does nothing while the agency switch is off.
 */
export async function runWeeklyDigest(now: Date = new Date()): Promise<WeeklyDigestResult> {
  await loadDevVars();
  const week = weekStart(now);
  const result: WeeklyDigestResult = {
    enabled: false,
    weekStart: week,
    sent: 0,
    skipped: 0,
    failed: 0,
    alreadyDone: 0,
    optedOut: 0,
  };

  if (!(await isWeeklyDigestEnabled())) return result;
  result.enabled = true;

  const { data: logins, error: loginsError } = await supabaseAdmin
    .from("clients")
    .select("id, user_id, name, company_name")
    .not("user_id", "is", null)
    .order("id");
  if (loginsError) throw new Error(`Couldn't load client logins: ${loginsError.message}`);

  const { data: optOuts, error: prefsError } = await supabaseAdmin
    .from("user_notification_prefs")
    .select("user_id")
    .eq("weekly_digest", false);
  if (prefsError) throw new Error(`Couldn't load notification settings: ${prefsError.message}`);
  const optedOut = new Set((optOuts ?? []).map((p) => p.user_id));

  const { data: done, error: runsError } = await supabaseAdmin
    .from("digest_runs")
    .select("user_id")
    .eq("week_start", week);
  if (runsError) throw new Error(`Couldn't load this week's runs: ${runsError.message}`);
  const alreadyDone = new Set((done ?? []).map((r) => r.user_id));

  // A login linked to more than one client row gets one digest, for the first row.
  const seen = new Set<string>();
  let sentBefore = false;

  for (const login of logins ?? []) {
    const userId = login.user_id;
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    if (optedOut.has(userId)) {
      result.optedOut += 1;
      continue;
    }
    if (alreadyDone.has(userId)) {
      result.alreadyDone += 1;
      continue;
    }

    // Claim this user's row for the week before sending, so two overlapping
    // runs can't both email them (the unique index lets only one insert win).
    // It starts as failed/"in progress" and is updated once the send settles.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from("digest_runs")
      .upsert(
        {
          user_id: userId,
          week_start: week,
          status: DIGEST_RUN_STATUS.failed,
          detail: "In progress",
        },
        { onConflict: "user_id,week_start", ignoreDuplicates: true },
      )
      .select("id");
    if (claimError) {
      console.error("digest_runs claim failed", userId, claimError.message);
      result.failed += 1;
      continue;
    }
    if (!claimed?.length) {
      result.alreadyDone += 1;
      continue;
    }
    const runId = claimed[0].id;

    let status: DigestRunStatus;
    let detail: string;
    try {
      const data = await loadClientDigestData(login.id, now);
      const email = buildDigest(data, {
        now,
        recipientName: login.company_name || login.name,
      });
      if (!email) {
        status = DIGEST_RUN_STATUS.skipped;
        detail = "Nothing to report";
      } else {
        const to = await userEmail(userId);
        if (!to) {
          status = DIGEST_RUN_STATUS.failed;
          detail = "Login has no email address";
        } else {
          if (sentBefore) await sleep(SEND_SPACING_MS);
          sentBefore = true;
          await sendViaResend(email.subject, email.html, { to, text: email.text });
          status = DIGEST_RUN_STATUS.sent;
          detail = `${email.itemCount} item${email.itemCount === 1 ? "" : "s"}`;
        }
      }
    } catch (err) {
      status = DIGEST_RUN_STATUS.failed;
      detail = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    }

    result[status] += 1;
    const { error: updateError } = await supabaseAdmin
      .from("digest_runs")
      .update({ status, detail })
      .eq("id", runId);
    if (updateError) console.error("digest_runs update failed", userId, updateError.message);
  }

  return result;
}

export interface TestDigestResult {
  sent: boolean;
  to: string;
  itemCount: number;
}

/**
 * Builds the digest across every client (the agency admin's view) and sends
 * it only to that admin's own login email. Ignores the agency switch and
 * writes no digest_runs row. The caller must have checked the admin role.
 */
export async function sendTestDigest(
  userId: string,
  now: Date = new Date(),
): Promise<TestDigestResult> {
  await loadDevVars();
  const to = await userEmail(userId);
  if (!to) throw new Error("Your login has no email address to send the test to.");
  const data = await loadAgencyDigestData(now);
  const email = buildDigest(data, { now, showClientName: true, isTest: true });
  if (!email) return { sent: false, to, itemCount: 0 };
  await sendViaResend(email.subject, email.html, { to, text: email.text });
  return { sent: true, to, itemCount: email.itemCount };
}
