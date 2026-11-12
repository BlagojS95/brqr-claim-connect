// The executive loss report (fix 46): generate, download as a server-rendered
// PDF, share, and schedule monthly. Report data is always read with the
// caller's own token, so RLS limits it to what they may see.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { isAgencyAdmin } from "@/lib/client-access.server";
import { formatDate } from "@/lib/dates";
import {
  DEFAULT_LARGE_LOSS_THRESHOLD,
  MAX_LARGE_LOSS_THRESHOLD,
  type ExecutiveReport,
} from "@/lib/executive-report";
import {
  canScheduleReport,
  loadExecutiveReport,
  loginEmail,
  renderReportFile,
} from "@/lib/executive-report.server";
import { forbidden, parseInput, unprocessable } from "@/lib/http-errors.server";
import { parseIsoDate } from "@/lib/insights-period";
import { loadDevVars } from "@/lib/load-dev-vars.server";
import { emailReport } from "@/lib/monthly-report.server";
import {
  SHARE_DAYS_DEFAULT,
  SHARE_TOKEN_RE,
  SHARED_REPORT_KIND,
  ShareDaysSchema,
} from "@/lib/shared-reports";
import { canManageShares, hashShareToken, storeSharedReport } from "@/lib/shared-reports.server";

const isoDate = z.string().refine((v) => parseIsoDate(v) !== null, "Enter a valid date");
const RangeSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.from <= r.to, "The start date must be before the end date");

export const ReportRequestSchema = z.object({
  clientId: z.string().uuid(),
  period: RangeSchema,
  comparison: RangeSchema,
  threshold: z.number().min(0).max(MAX_LARGE_LOSS_THRESHOLD).default(DEFAULT_LARGE_LOSS_THRESHOLD),
  brokerNotes: z.string().trim().max(4000).optional(),
});
type ReportRequest = z.infer<typeof ReportRequestSchema>;

async function buildReport(
  context: { supabase: Parameters<typeof loadExecutiveReport>[0]; userId: string },
  data: ReportRequest,
): Promise<ExecutiveReport> {
  // Broker notes are written by agency staff; anything a client sends is ignored.
  const notes = data.brokerNotes && (await isAgencyAdmin(context.userId)) ? data.brokerNotes : null;
  const report = await loadExecutiveReport(context.supabase, data.clientId, {
    period: data.period,
    comparison: data.comparison,
    threshold: data.threshold,
    brokerNotes: notes,
  });
  if (!report) forbidden("You can't see reports for this client");
  return report;
}

export const generateExecutiveReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(ReportRequestSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    return buildReport(context, data);
  });

// The PDF is drawn here on the server and handed back as base64.
export const downloadExecutiveReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(ReportRequestSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    return renderReportFile(await buildReport(context, data));
  });

export const createExecutiveReportShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    parseInput(ReportRequestSchema.extend({ days: ShareDaysSchema.default(SHARE_DAYS_DEFAULT) })),
  )
  .handler(async ({ data, context }) => {
    await loadDevVars();
    if (!(await canManageShares(context.userId, data.clientId))) {
      forbidden("Only BRQR or your company's admin can share reports");
    }
    const report = await buildReport(context, data);
    return storeSharedReport({
      kind: SHARED_REPORT_KIND.executiveReport,
      clientId: data.clientId,
      title: `Executive Loss Report: ${report.clientName} (${formatDate(report.period.from)} – ${formatDate(report.period.to)})`,
      snapshot: report as unknown as Json,
      days: data.days,
      createdBy: context.userId,
    });
  });

// A shared link's PDF: no sign-in, drawn from that link's frozen report only.
export const downloadSharedExecutiveReport = createServerFn({ method: "POST" })
  .inputValidator(parseInput(z.object({ token: z.string().max(64) })))
  .handler(async ({ data }) => {
    if (!SHARE_TOKEN_RE.test(data.token)) return null;
    await loadDevVars();
    const { data: row } = await supabaseAdmin
      .from("shared_reports")
      .select("snapshot")
      .eq("token_hash", hashShareToken(data.token))
      .eq("kind", SHARED_REPORT_KIND.executiveReport)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    const report = row?.snapshot as unknown as ExecutiveReport | undefined;
    if (!report || report.version !== 1) return null;
    return renderReportFile(report);
  });

// ── Monthly email ──────────────────────────────────────────────────────────

export interface ReportScheduleState {
  /** This login gets the client's report every month. */
  scheduled: boolean;
  threshold: number;
  /** The agency's master switch; while off, nothing is sent. */
  agencyEnabled: boolean;
  canSchedule: boolean;
}

export const fetchReportSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(z.object({ clientId: z.string().uuid() })))
  .handler(async ({ data, context }): Promise<ReportScheduleState> => {
    await loadDevVars();
    const [{ data: row }, { data: settings }, canSchedule] = await Promise.all([
      context.supabase
        .from("report_schedules")
        .select("large_loss_threshold")
        .eq("client_id", data.clientId)
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("agency_settings")
        .select("monthly_report_enabled")
        .eq("id", 1)
        .maybeSingle(),
      canScheduleReport(context.userId, data.clientId),
    ]);
    return {
      scheduled: !!row,
      threshold: row ? Number(row.large_loss_threshold) : DEFAULT_LARGE_LOSS_THRESHOLD,
      agencyEnabled: settings?.monthly_report_enabled === true,
      canSchedule,
    };
  });

export const setReportSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    parseInput(
      z.object({
        clientId: z.string().uuid(),
        on: z.boolean(),
        threshold: z
          .number()
          .min(0)
          .max(MAX_LARGE_LOSS_THRESHOLD)
          .default(DEFAULT_LARGE_LOSS_THRESHOLD),
      }),
    ),
  )
  .handler(async ({ data, context }) => {
    await loadDevVars();
    if (!(await canScheduleReport(context.userId, data.clientId))) {
      forbidden("You can't schedule this client's report");
    }
    // The schedule always belongs to the caller: the email only goes to them.
    if (data.on) {
      const { error } = await supabaseAdmin.from("report_schedules").upsert(
        {
          client_id: data.clientId,
          user_id: context.userId,
          large_loss_threshold: data.threshold,
        },
        { onConflict: "client_id,user_id" },
      );
      if (error) throw new Error(`Couldn't save the schedule: ${error.message}`);
    } else {
      const { error } = await supabaseAdmin
        .from("report_schedules")
        .delete()
        .eq("client_id", data.clientId)
        .eq("user_id", context.userId);
      if (error) throw new Error(`Couldn't stop the schedule: ${error.message}`);
    }
    return { ok: true };
  });

// "Send me a test": this report, now, to the caller's own email only.
export const sendTestExecutiveReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(ReportRequestSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    if (!(await canScheduleReport(context.userId, data.clientId))) {
      forbidden("You can't email this client's report");
    }
    const to = await loginEmail(context.userId);
    if (!to) unprocessable("Your login has no email address to send the test to");
    await emailReport(to, await buildReport(context, data), true);
    return { to };
  });

// The agency's master switch for the monthly emails.
export const setMonthlyReportEnabled = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(z.object({ enabled: z.boolean() })))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("agency_settings")
      .update({ monthly_report_enabled: data.enabled })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
