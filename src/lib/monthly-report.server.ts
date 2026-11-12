// The monthly executive loss report email (fix 46), run by the Vercel cron in
// vercel.json. Off until an agency admin turns on
// agency_settings.monthly_report_enabled, like the weekly digest.
//
// Each schedule gets last month's report (compared with the same month a
// year earlier) as a PDF, sent only to the login that scheduled it, and only
// while that login may still see the whole company.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { escapeHtml, sendViaResend } from "@/lib/claim-notifications.server";
import { formatDate, todayIso } from "@/lib/dates";
import { addDays, addYears, type DateRange } from "@/lib/insights-period";
import type { ExecutiveReport } from "@/lib/executive-report";
import {
  canScheduleReport,
  loadExecutiveReport,
  loginEmail,
  renderReportFile,
} from "@/lib/executive-report.server";

// Resend's default limit is 2 requests a second; keep sends below it.
const SEND_SPACING_MS = 600;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Last calendar month and the same month a year earlier, for `today`. */
export function previousMonth(today: string): {
  monthStart: string;
  period: DateRange;
  comparison: DateRange;
} {
  const thisMonth = `${today.slice(0, 7)}-01`;
  const end = addDays(thisMonth, -1);
  const period = { from: `${end.slice(0, 7)}-01`, to: end };
  return {
    monthStart: thisMonth,
    period,
    comparison: { from: addYears(period.from, -1), to: addYears(period.to, -1) },
  };
}

export async function isMonthlyReportEnabled(): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("agency_settings")
    .select("monthly_report_enabled")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read agency settings: ${error.message}`);
  return data?.monthly_report_enabled === true;
}

const NAVY = "#0B213E";

export function reportEmail(report: ExecutiveReport, { isTest = false } = {}) {
  const period = `${formatDate(report.period.from)} – ${formatDate(report.period.to)}`;
  const h = report.headline.current;
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  const subject = `${isTest ? "[TEST] " : ""}Executive Loss Report: ${report.clientName}, ${period}`;
  const text = [
    isTest ? "TEST: this is a test send of the monthly report.\n" : "",
    `Your Executive Loss Report for ${report.clientName} (${period}) is attached as a PDF.`,
    "",
    `New claims: ${h.claims} · Open: ${h.open} · Closed: ${h.closed}`,
    `Paid: ${money(h.paid)} · Reserve: ${money(h.reserve)} · Incurred: ${money(h.incurred)}`,
    "",
    'To stop these emails, turn off "Email me this report monthly" on Reports > Executive Report in ClaimsQR.',
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;color:#0A1628;max-width:560px;">
  ${isTest ? `<p style="background:#FFF4D6;padding:8px 12px;border-radius:6px;">TEST: this is a test send of the monthly report.</p>` : ""}
  <h2 style="color:${NAVY};margin:0 0 8px;">Executive Loss Report</h2>
  <p style="margin:0 0 16px;">${escapeHtml(report.clientName)} · ${escapeHtml(period)}</p>
  <p>Your report is attached as a PDF.</p>
  <table style="border-collapse:collapse;font-size:14px;">
    <tr><td style="padding:4px 16px 4px 0;">New claims</td><td><b>${h.claims}</b></td></tr>
    <tr><td style="padding:4px 16px 4px 0;">Open / closed (today)</td><td><b>${h.open} / ${h.closed}</b></td></tr>
    <tr><td style="padding:4px 16px 4px 0;">Paid</td><td><b>${money(h.paid)}</b></td></tr>
    <tr><td style="padding:4px 16px 4px 0;">Reserve</td><td><b>${money(h.reserve)}</b></td></tr>
    <tr><td style="padding:4px 16px 4px 0;">Incurred</td><td><b>${money(h.incurred)}</b></td></tr>
  </table>
  <p style="color:#5A6472;font-size:12px;margin-top:24px;">To stop these emails, turn off "Email me this report monthly" on Reports &gt; Executive Report in ClaimsQR.</p>
</div>`;
  return { subject, html, text };
}

export async function emailReport(to: string, report: ExecutiveReport, isTest = false) {
  const file = await renderReportFile(report);
  const email = reportEmail(report, { isTest });
  await sendViaResend(email.subject, email.html, {
    to,
    text: email.text,
    attachments: [{ filename: file.fileName, content: file.base64 }],
  });
}

export interface MonthlyReportResult {
  enabled: boolean;
  month: string;
  sent: number;
  skipped: number;
  failed: number;
  alreadyDone: number;
}

export async function runMonthlyReports(today: string = todayIso()): Promise<MonthlyReportResult> {
  const { monthStart, period, comparison } = previousMonth(today);
  const result: MonthlyReportResult = {
    enabled: false,
    month: period.from.slice(0, 7),
    sent: 0,
    skipped: 0,
    failed: 0,
    alreadyDone: 0,
  };
  if (!(await isMonthlyReportEnabled())) return result;
  result.enabled = true;

  const { data: schedules, error } = await supabaseAdmin
    .from("report_schedules")
    .select("id, client_id, user_id, large_loss_threshold, last_sent_month");
  if (error) throw new Error(`Couldn't load report schedules: ${error.message}`);

  let sentBefore = false;
  for (const s of schedules ?? []) {
    if (s.last_sent_month && s.last_sent_month >= monthStart) {
      result.alreadyDone += 1;
      continue;
    }
    try {
      // Roles change: check again that this login may still see the whole company.
      const [allowed, to] = await Promise.all([
        canScheduleReport(s.user_id, s.client_id),
        loginEmail(s.user_id),
      ]);
      if (!allowed || !to) {
        result.skipped += 1;
        continue;
      }
      const report = await loadExecutiveReport(
        supabaseAdmin,
        s.client_id,
        { period, comparison, threshold: Number(s.large_loss_threshold), brokerNotes: null },
        today,
      );
      if (!report) {
        result.skipped += 1;
        continue;
      }
      if (sentBefore) await sleep(SEND_SPACING_MS);
      await emailReport(to, report);
      sentBefore = true;
      await supabaseAdmin
        .from("report_schedules")
        .update({ last_sent_month: monthStart })
        .eq("id", s.id);
      result.sent += 1;
    } catch (err) {
      console.error("monthly report failed", s.id, err);
      result.failed += 1;
    }
  }
  return result;
}
