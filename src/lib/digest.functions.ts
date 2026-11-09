import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseInput } from "@/lib/http-errors.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { countDigestRuns, type DigestRunCounts } from "@/lib/digest";

// Settings page (fix 33). Reads and writes use the caller's token, so RLS
// limits each user to their own notification row and lets only an
// agency_admin change agency_settings or read digest_runs. The admin-only
// functions also check the role up front with requireAgencyAdmin.

export interface DigestRunSummary {
  weekStart: string;
  counts: DigestRunCounts;
}

export interface NotificationSettings {
  weeklyDigest: boolean;
  /** Only filled in for an agency_admin. */
  agency: {
    weeklyDigestEnabled: boolean;
    lastRun: DigestRunSummary | null;
  } | null;
}

export const fetchNotificationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NotificationSettings> => {
    const { supabase, userId } = context;

    const [{ data: pref, error: prefError }, { data: role, error: roleError }] = await Promise.all([
      supabase
        .from("user_notification_prefs")
        .select("weekly_digest")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "agency_admin")
        .maybeSingle(),
    ]);
    if (prefError) throw new Error(prefError.message);
    if (roleError) throw new Error(roleError.message);

    // No row means subscribed.
    const weeklyDigest = pref?.weekly_digest ?? true;
    if (!role) return { weeklyDigest, agency: null };

    const { data: settings, error: settingsError } = await supabase
      .from("agency_settings")
      .select("weekly_digest_enabled")
      .eq("id", 1)
      .maybeSingle();
    if (settingsError) throw new Error(settingsError.message);

    const { data: latest, error: latestError } = await supabase
      .from("digest_runs")
      .select("week_start")
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw new Error(latestError.message);

    let lastRun: DigestRunSummary | null = null;
    if (latest) {
      const { data: runs, error: runsError } = await supabase
        .from("digest_runs")
        .select("status")
        .eq("week_start", latest.week_start);
      if (runsError) throw new Error(runsError.message);
      lastRun = { weekStart: latest.week_start, counts: countDigestRuns(runs ?? []) };
    }

    return {
      weeklyDigest,
      agency: { weeklyDigestEnabled: settings?.weekly_digest_enabled === true, lastRun },
    };
  });

const EnabledSchema = z.object({ enabled: z.boolean() });

export const updateWeeklyDigestPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(EnabledSchema))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("user_notification_prefs").upsert(
      {
        user_id: context.userId,
        weekly_digest: data.enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateAgencyWeeklyDigest = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(EnabledSchema))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("agency_settings")
      .update({ weekly_digest_enabled: data.enabled, updated_at: new Date().toISOString() })
      .eq("id", 1)
      .select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Agency settings row not found");
    return { ok: true };
  });

export const sendMeTestDigest = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .handler(async ({ context }) => {
    // Imported here so the service-role job never reaches a client bundle.
    const { sendTestDigest } = await import("@/lib/digest.server");
    return sendTestDigest(context.userId);
  });
