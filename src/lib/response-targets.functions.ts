import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseInput } from "@/lib/http-errors.server";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { loadResponseTargets } from "@/lib/response-targets.server";
import { fetchAll } from "@/lib/fetch-all";
import type { ClaimStatus } from "@/lib/claim-status";
import {
  claimResponseTimes,
  RESPONSE_TARGET_MAX_DAYS,
  RESPONSE_TARGET_MIN_DAYS,
  responseTimesLines,
  STAFF_METRICS_WINDOW_DAYS,
  staffResponseMetrics,
  type ResponseTargets,
  type ResponseTimes,
  type StaffMetricsClaim,
  type StaffResponseMetrics,
} from "@/lib/response-targets";

// Response targets (fix 56). Agency admins only: every function checks the role
// with requireAgencyAdmin and then queries with the caller's own token, so RLS
// applies as well (agency_settings is readable by any signed-in user and
// writable only by an agency_admin). No service-role client.

export interface ClaimResponseTimesResult {
  times: ResponseTimes;
  targets: ResponseTargets;
  /** Ready-to-show text, e.g. "Submitted to carrier in 1 business day". */
  lines: string[];
}

/** For the "Response times" field on claim detail. */
export const fetchClaimResponseTimes = createServerFn({ method: "GET" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(z.object({ claimId: z.string().uuid() })))
  .handler(async ({ data, context }): Promise<ClaimResponseTimesResult | null> => {
    const [{ data: claim, error }, targets] = await Promise.all([
      context.supabase
        .from("claims")
        .select("status, created_at, submitted_to_carrier_at, first_carrier_contact_at")
        .eq("id", data.claimId)
        .maybeSingle(),
      loadResponseTargets(context.supabase),
    ]);
    if (error) throw new Error(error.message);
    if (!claim) return null;
    const times = claimResponseTimes(claim, targets, new Date());
    return { times, targets, lines: responseTimesLines(claim, times, targets) };
  });

const TargetsSchema = z.object({
  submitTargetDays: z.number().int().min(RESPONSE_TARGET_MIN_DAYS).max(RESPONSE_TARGET_MAX_DAYS),
  firstContactTargetDays: z
    .number()
    .int()
    .min(RESPONSE_TARGET_MIN_DAYS)
    .max(RESPONSE_TARGET_MAX_DAYS),
});

export const updateResponseTargets = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(TargetsSchema))
  .handler(async ({ data, context }): Promise<ResponseTargets> => {
    const { data: rows, error } = await context.supabase
      .from("agency_settings")
      .update({
        submit_target_business_days: data.submitTargetDays,
        first_contact_target_business_days: data.firstContactTargetDays,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)
      .select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Agency settings row not found");
    return data;
  });

interface MetricsRow {
  status: ClaimStatus;
  created_at: string;
  submitted_to_carrier_at: string | null;
  first_carrier_contact_at: string | null;
  assigned_to: string | null;
}

export interface StaffMetricsResult {
  windowDays: number;
  rows: StaffResponseMetrics[];
}

/** Average response times per assigned staff member, claims created in the last 90 days. */
export const fetchStaffResponseMetrics = createServerFn({ method: "GET" })
  .middleware([requireAgencyAdmin])
  .handler(async ({ context }): Promise<StaffMetricsResult> => {
    const since = new Date(Date.now() - STAFF_METRICS_WINDOW_DAYS * 86_400_000).toISOString();
    const claims = await fetchAll<MetricsRow>((from, to) =>
      context.supabase
        .from("claims")
        .select(
          "status, created_at, submitted_to_carrier_at, first_carrier_contact_at, assigned_to",
        )
        .gte("created_at", since)
        .order("id")
        .range(from, to),
    );
    return {
      windowDays: STAFF_METRICS_WINDOW_DAYS,
      rows: staffResponseMetrics(claims satisfies StaffMetricsClaim[]),
    };
  });
