// Loading and producing the executive loss report (fix 46). Server-only.
//
// loadExecutiveReportData reads with whatever client it is given: the
// caller's own token from the Reports tab (so RLS limits the report to what
// they may see), or the service role for the monthly email, which only runs
// for logins allowed to see the whole company.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Tables } from "@/integrations/supabase/types";
import { getClientMembership, isAgencyAdmin } from "@/lib/client-access.server";
import { isCompanyWide } from "@/lib/client-users";
import { todayIso } from "@/lib/dates";
import {
  buildExecutiveReport,
  type ExecutiveReport,
  type ReserveChange,
} from "@/lib/executive-report";
import {
  executiveReportFileName,
  renderExecutiveReportPdf,
} from "@/lib/exports/executive-report-pdf";
import { fetchAll } from "@/lib/fetch-all";
import type { DateRange } from "@/lib/insights-period";
import { loadClientClaims, toPolicy, type PolicyRow } from "@/lib/overview.server";

export interface ReportOptions {
  period: DateRange;
  comparison: DateRange;
  threshold: number;
  brokerNotes: string | null;
}

export async function loadExecutiveReport(
  supabase: SupabaseClient<Database>,
  clientId: string,
  options: ReportOptions,
  today: string = todayIso(),
): Promise<ExecutiveReport | null> {
  const loaded = await loadClientClaims(supabase, clientId);
  if (!loaded) return null;
  const claimIds = loaded.claims.map((c) => c.id);

  const [policyRows, { data: lines, error: linesError }, changes, first] = await Promise.all([
    fetchAll<PolicyRow>((from, to) =>
      supabase
        .from("policies")
        .select("*, client_locations(name)")
        .eq("client_id", clientId)
        .order("id")
        .range(from, to),
    ),
    supabase.from("lines_of_business").select("id, name, code").order("sort_order"),
    loadReserveChanges(supabase, claimIds, options.period),
    supabase
      .from("claim_reserve_history")
      .select("changed_at")
      .order("changed_at")
      .limit(1)
      .maybeSingle(),
  ]);
  if (linesError) throw new Error(`Couldn't load lines of business: ${linesError.message}`);

  return buildExecutiveReport({
    clientName: loaded.clientName,
    period: options.period,
    comparison: options.comparison,
    threshold: options.threshold,
    brokerNotes: options.brokerNotes,
    today,
    claims: loaded.claims,
    policies: policyRows.map((p) => toPolicy(p, loaded.clientName)),
    lines: lines ?? [],
    reserveChanges: changes,
    reserveHistorySince: first.data?.changed_at ?? null,
  });
}

// Reserve changes on these claims during the period (by UTC date, a day
// either side so no change near midnight is lost; the report trims to the period).
async function loadReserveChanges(
  supabase: SupabaseClient<Database>,
  claimIds: string[],
  period: DateRange,
): Promise<ReserveChange[]> {
  if (!claimIds.length) return [];
  const out: ReserveChange[] = [];
  // Keep the id list in the URL short.
  for (let i = 0; i < claimIds.length; i += 150) {
    const ids = claimIds.slice(i, i + 150);
    const rows = await fetchAll<
      Pick<
        Tables<"claim_reserve_history">,
        "claim_id" | "old_reserve" | "new_reserve" | "changed_at"
      >
    >((from, to) =>
      supabase
        .from("claim_reserve_history")
        .select("claim_id, old_reserve, new_reserve, changed_at")
        .in("claim_id", ids)
        .gte("changed_at", `${period.from}T00:00:00Z`)
        .lte("changed_at", `${period.to}T23:59:59.999Z`)
        .order("changed_at")
        .order("id")
        .range(from, to),
    );
    out.push(...rows);
  }
  return out;
}

export async function renderReportFile(report: ExecutiveReport) {
  const bytes = await renderExecutiveReportPdf(report);
  return {
    fileName: executiveReportFileName(report),
    base64: Buffer.from(bytes).toString("base64"),
  };
}

/**
 * Who may get this client's report emailed every month: agency staff, or the
 * client's admins and company-wide users (not location users, whose view is
 * limited to some sites).
 */
export async function canScheduleReport(userId: string, clientId: string): Promise<boolean> {
  if (await isAgencyAdmin(userId)) return true;
  const member = await getClientMembership(userId);
  return member?.clientId === clientId && isCompanyWide(member.role);
}

export async function loginEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error) throw new Error(`Couldn't load the login: ${error.message}`);
  return data.user?.email?.trim() || null;
}
