// Read-only share links for reports (fixes 44 and 46).
//
// Making a link: an agency admin (any client) or a client's admin (their own
// company) asks for one; the report is computed here with the caller's own
// token, so RLS limits it to what they may see, and frozen into the row. The
// browser gets the token once; only its SHA-256 hash is stored.
//
// Opening a link needs no sign-in: fetchSharedReport looks the row up by the
// token's hash with the service role and returns that one row's snapshot, so
// a link can only ever show the single report it was made for.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { todayIso } from "@/lib/dates";
import { forbidden, parseInput } from "@/lib/http-errors.server";
import { loadDevVars } from "@/lib/load-dev-vars.server";
import { filterLossSummary, lossSummaryFilterLabel } from "@/lib/loss-summary";
import { loadClientClaims } from "@/lib/overview.server";
import { canManageShares, hashShareToken, storeSharedReport } from "@/lib/shared-reports.server";
import {
  LossSummaryFiltersSchema,
  SHARE_DAYS_DEFAULT,
  SHARE_TOKEN_RE,
  SHARED_REPORT_KIND,
  ShareDaysSchema,
  type LossSummarySnapshot,
  type SharedReportKind,
  type SharedReportSummary,
} from "@/lib/shared-reports";

const CreateLossSummaryShareSchema = z.object({
  clientId: z.string().uuid(),
  filters: LossSummaryFiltersSchema,
  days: ShareDaysSchema.default(SHARE_DAYS_DEFAULT),
});

export const createLossSummaryShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(CreateLossSummaryShareSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    if (!(await canManageShares(context.userId, data.clientId))) {
      forbidden("Only BRQR or your company's admin can share reports");
    }
    // Caller's token: the report holds only claims this user can see.
    const loaded = await loadClientClaims(context.supabase, data.clientId);
    if (!loaded) forbidden("You can't share reports for this client");

    const claims = filterLossSummary(loaded.claims, data.filters).map((c) => ({
      id: c.id,
      claim_number: c.claim_number,
      status: c.status,
      line_of_business: c.line_of_business,
      carrier: c.carrier,
      date_of_loss: c.date_of_loss,
      paid_amount: c.paid_amount === null ? null : Number(c.paid_amount),
      reserve_amount: c.reserve_amount === null ? null : Number(c.reserve_amount),
    }));
    const snapshot: LossSummarySnapshot = {
      version: 1,
      valuedAsOf: todayIso(),
      clientName: loaded.clientName,
      filters: data.filters,
      claims,
    };
    return storeSharedReport({
      kind: SHARED_REPORT_KIND.lossSummary,
      clientId: data.clientId,
      title: `Loss Summary: ${loaded.clientName} (${lossSummaryFilterLabel(data.filters)})`,
      snapshot: snapshot as unknown as Json,
      days: data.days,
      createdBy: context.userId,
    });
  });

// Caller's token: RLS shows agency admins every link and a client admin their
// company's. Never returns the snapshot or the token hash.
export const listSharedReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(z.object({ clientId: z.string().uuid().optional() })))
  .handler(async ({ data, context }): Promise<SharedReportSummary[]> => {
    let query = context.supabase
      .from("shared_reports")
      .select("id, kind, client_id, title, created_at, expires_at, revoked_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.clientId) query = query.eq("client_id", data.clientId);
    const { data: rows, error } = await query;
    if (error) throw new Error(`Couldn't load your shared links: ${error.message}`);
    return (rows ?? []).map((r) => ({ ...r, kind: r.kind as SharedReportKind }));
  });

export const revokeSharedReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(z.object({ id: z.string().uuid() })))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    const { data: row } = await supabaseAdmin
      .from("shared_reports")
      .select("id, client_id, revoked_at")
      .eq("id", data.id)
      .maybeSingle();
    // Same answer for "not yours" and "doesn't exist".
    if (!row || !(await canManageShares(context.userId, row.client_id))) {
      forbidden("You can't revoke this link");
    }
    if (row.revoked_at) return { ok: true };
    const { error } = await supabaseAdmin
      .from("shared_reports")
      .update({ revoked_at: new Date().toISOString(), revoked_by: context.userId })
      .eq("id", row.id);
    if (error) throw new Error(`Couldn't revoke the link: ${error.message}`);
    return { ok: true };
  });

export interface SharedReport {
  kind: SharedReportKind;
  title: string;
  expiresAt: string;
  snapshot: Json;
}

// No sign-in: anyone holding the link. Expired, revoked and unknown links all
// get the same null, so a guess learns nothing.
export const fetchSharedReport = createServerFn({ method: "GET" })
  .inputValidator(parseInput(z.object({ token: z.string().max(64) })))
  .handler(async ({ data }): Promise<SharedReport | null> => {
    if (!SHARE_TOKEN_RE.test(data.token)) return null;
    await loadDevVars();
    const { data: row } = await supabaseAdmin
      .from("shared_reports")
      .select("kind, title, expires_at, snapshot")
      .eq("token_hash", hashShareToken(data.token))
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!row) return null;
    return {
      kind: row.kind as SharedReportKind,
      title: row.title,
      expiresAt: row.expires_at,
      snapshot: row.snapshot,
    };
  });
