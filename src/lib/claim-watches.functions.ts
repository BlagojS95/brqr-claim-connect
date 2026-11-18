// Watching claims and choosing which email alerts to get (fix 48). Everything
// runs with the caller's own token, so RLS limits watches to the caller's own
// rows on claims they can see, and preferences to their own row.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { httpError, parseInput } from "@/lib/http-errors.server";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ALERT_EVENTS,
  ALERT_PREF_COLUMNS,
  alertPrefsFromRow,
  type AlertPrefs,
} from "@/lib/claim-alerts";

/** Ids of the claims the caller watches. */
export const fetchWatchedClaimIds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<string[]> => {
    const { data, error } = await context.supabase
      .from("claim_watches")
      .select("claim_id")
      .eq("user_id", context.userId);
    if (error) throw new Error(`Couldn't load watched claims: ${error.message}`);
    return (data ?? []).map((r) => r.claim_id);
  });

const WatchSchema = z.object({ claimId: z.string().uuid(), watching: z.boolean() });

export const setClaimWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(WatchSchema))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.watching) {
      const { error } = await supabase
        .from("claim_watches")
        .delete()
        .eq("user_id", userId)
        .eq("claim_id", data.claimId);
      if (error) throw new Error(`Couldn't stop watching: ${error.message}`);
      return { watching: false };
    }
    // The claim must be visible to the caller (RLS); the insert policy checks again.
    const { data: claim, error: claimError } = await supabase
      .from("claims")
      .select("id")
      .eq("id", data.claimId)
      .maybeSingle();
    if (claimError) throw new Error(`Couldn't load the claim: ${claimError.message}`);
    if (!claim) httpError(404, "Claim not found");
    const { error } = await supabase
      .from("claim_watches")
      .upsert(
        { user_id: userId, claim_id: data.claimId },
        { onConflict: "user_id,claim_id", ignoreDuplicates: true },
      );
    if (error) throw new Error(`Couldn't watch the claim: ${error.message}`);
    return { watching: true };
  });

export const fetchAlertPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AlertPrefs> => {
    const { data, error } = await context.supabase
      .from("user_notification_prefs")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return alertPrefsFromRow(data);
  });

const PrefSchema = z.object({
  event: z.enum(ALERT_EVENTS),
  scope: z.enum(["watched", "all"]),
  enabled: z.boolean(),
});

export const updateAlertPref = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(PrefSchema))
  .handler(async ({ data, context }) => {
    const column = ALERT_PREF_COLUMNS[data.event][data.scope];
    const row: Database["public"]["Tables"]["user_notification_prefs"]["Insert"] = {
      user_id: context.userId,
      updated_at: new Date().toISOString(),
    };
    row[column] = data.enabled;
    const { error } = await context.supabase
      .from("user_notification_prefs")
      .upsert(row, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
