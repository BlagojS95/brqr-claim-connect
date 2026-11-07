import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseInput } from "@/lib/http-errors.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveActivityAuthors } from "@/lib/claim-activity.server";
import {
  CLAIM_ACTIVITY_KIND,
  MAX_ACTIVITY_NOTE_LENGTH,
  sortActivityNewestFirst,
  type ClaimActivityEntry,
} from "@/lib/claim-activity";
import { loadDevVars } from "@/lib/load-dev-vars.server";

const ClaimIdSchema = z.object({ claimId: z.string().uuid() });

const AddNoteSchema = z.object({
  claimId: z.string().uuid(),
  body: z
    .string()
    .trim()
    .min(1, "Write a note first")
    .max(MAX_ACTIVITY_NOTE_LENGTH, `Notes can be at most ${MAX_ACTIVITY_NOTE_LENGTH} characters`),
});

// The claim's activity log, newest first. Rows are read with the caller's
// token, so RLS limits a client to their own claims; only the author display
// names are resolved with the service role.
export const fetchClaimActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(ClaimIdSchema))
  .handler(async ({ data, context }): Promise<ClaimActivityEntry[]> => {
    await loadDevVars();
    const { supabase, userId } = context;
    const [{ data: rows, error }, { data: adminRole }] = await Promise.all([
      supabase
        .from("claim_activity")
        .select("id, actor_id, kind, body, created_at")
        .eq("claim_id", data.claimId)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "agency_admin")
        .maybeSingle(),
    ]);
    if (error) throw new Error(`Couldn't load activity: ${error.message}`);

    const authors = await resolveActivityAuthors(
      (rows ?? []).map((r) => r.actor_id),
      { showAgencyEmails: !!adminRole },
    );
    return sortActivityNewestFirst(rows ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      body: r.body,
      created_at: r.created_at,
      author: r.actor_id ? (authors.get(r.actor_id) ?? "Unknown user") : "System",
    }));
  });

// "Add note" on the claim page. Inserted with the caller's token: RLS lets a
// client add only a note, as themselves, on their own claim; admins on any.
export const addClaimNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(AddNoteSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    const { error } = await context.supabase.from("claim_activity").insert({
      claim_id: data.claimId,
      actor_id: context.userId,
      kind: CLAIM_ACTIVITY_KIND.note,
      body: data.body,
    });
    if (error) throw new Error(`Couldn't add the note: ${error.message}`);
    return { ok: true };
  });
