// Claim messages (fix 47). Every function first reads the claim with the
// caller's own token, so RLS decides whether they may see it (agency staff:
// any claim; client logins: their client's claims, location users only their
// locations'). Messages are read and inserted with the caller's token too; only
// names, the list of people who can be mentioned and the alert emails use the
// service role (claim-alerts.server.ts).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { httpError, parseInput } from "@/lib/http-errors.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadDevVars } from "@/lib/load-dev-vars.server";
import { assertViewScope } from "@/lib/view-as.server";
import {
  PostMessageSchema,
  findMentions,
  sortMessagesOldestFirst,
  type ClaimMessage,
  type MentionCandidate,
} from "@/lib/claim-messages";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const ClaimIdSchema = z.object({ claimId: z.string().uuid() });

/** The claim as the caller may see it (RLS), or 404. */
async function requireVisibleClaim(
  supabase: SupabaseClient<Database>,
  claimId: string,
  viewingClientId: string | null,
) {
  const { data: claim, error } = await supabase
    .from("claims")
    .select("id, client_id")
    .eq("id", claimId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't load the claim: ${error.message}`);
  if (!claim) httpError(404, "Claim not found");
  assertViewScope(viewingClientId, claim.client_id);
  return claim;
}

/** Everyone who may see the claim, as mention candidates (staff first, then by name). */
async function mentionCandidates(claimId: string, excludeId: string | null) {
  const { loadClaimAudience, loadPeople } = await import("@/lib/claim-alerts.server");
  const audience = await loadClaimAudience(claimId);
  if (!audience) httpError(404, "Claim not found");
  const people = await loadPeople(audience.members.map((m) => m.userId));
  const candidates: MentionCandidate[] = audience.members
    .filter((m) => m.userId !== excludeId && people.has(m.userId))
    .map((m) => ({
      userId: m.userId,
      name: people.get(m.userId)!.name,
      kind: m.isStaff ? "staff" : "client",
    }));
  candidates.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "staff" ? -1 : 1,
  );
  return { audience, people, candidates };
}

export const fetchClaimMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(ClaimIdSchema))
  .handler(async ({ data, context }): Promise<ClaimMessage[]> => {
    await loadDevVars();
    const { supabase, userId, viewingClientId } = context;
    await requireVisibleClaim(supabase, data.claimId, viewingClientId);

    const { data: rows, error } = await supabase
      .from("claim_messages")
      .select("id, author_id, body, mentions, created_at")
      .eq("claim_id", data.claimId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(`Couldn't load messages: ${error.message}`);
    if (!rows?.length) return [];

    const { loadPeople } = await import("@/lib/claim-alerts.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const authorIds = [...new Set(rows.map((r) => r.author_id).filter((id): id is string => !!id))];
    const mentionIds = rows.flatMap((r) => r.mentions ?? []);
    const [people, { data: staff }] = await Promise.all([
      loadPeople([...authorIds, ...mentionIds]),
      authorIds.length
        ? supabaseAdmin
            .from("user_roles")
            .select("user_id")
            .eq("role", "agency_admin")
            .in("user_id", authorIds)
        : Promise.resolve({ data: [] as { user_id: string }[] }),
    ]);
    const staffIds = new Set((staff ?? []).map((s) => s.user_id));

    return sortMessagesOldestFirst(
      rows.map((r) => ({
        id: r.id,
        body: r.body,
        createdAt: r.created_at,
        authorName: r.author_id ? (people.get(r.author_id)?.name ?? "Former user") : "Former user",
        authorIsStaff: !!r.author_id && staffIds.has(r.author_id),
        // While viewing as a client nothing is "mine": the admin isn't that client.
        isMine: !viewingClientId && r.author_id === userId,
        mentionNames: (r.mentions ?? [])
          .map((id) => people.get(id)?.name)
          .filter((n): n is string => !!n),
      })),
    );
  });

// The people the composer offers after "@": agency staff and the client's
// logins that can see this claim (not the caller).
export const fetchMessageMentionCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(ClaimIdSchema))
  .handler(async ({ data, context }): Promise<MentionCandidate[]> => {
    await loadDevVars();
    await requireVisibleClaim(context.supabase, data.claimId, context.viewingClientId);
    const { candidates } = await mentionCandidates(data.claimId, context.userId);
    return candidates;
  });

// Posts a message as the caller. The insert runs with the caller's token, so
// RLS checks they may post on this claim; the database adds the activity entry.
// Mentions are worked out here from the text, never taken from the browser.
// Alert emails go out afterwards; a failed email never fails the post.
export const postClaimMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(PostMessageSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    const { supabase, userId, viewingClientId } = context;
    await requireVisibleClaim(supabase, data.claimId, viewingClientId);
    const { audience, people, candidates } = await mentionCandidates(data.claimId, userId);
    const mentions = findMentions(data.body, candidates);

    const { data: row, error } = await supabase
      .from("claim_messages")
      .insert({ claim_id: data.claimId, author_id: userId, body: data.body, mentions })
      .select("id")
      .single();
    if (error) throw new Error(`Couldn't post the message: ${error.message}`);

    const { notifyNewMessage } = await import("@/lib/claim-alerts.server");
    const emails = await notifyNewMessage({
      audience,
      people,
      authorId: userId,
      body: data.body,
      mentionIds: mentions,
    });
    return { id: row.id, mentioned: mentions.length, emailed: emails.sent };
  });
