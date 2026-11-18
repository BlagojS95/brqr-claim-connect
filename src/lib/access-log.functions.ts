// The access log (fix 51): recording sign-ins, and reading the log for
// Settings > Activity (a client admin: their company) and agency staff (all
// clients, filterable). Rows are read with the caller's own token, so RLS
// decides what they may see; only the people's names are resolved with the
// service role, as on the claim activity log.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveActivityAuthors } from "@/lib/claim-activity.server";
import { getClientMembership, isAgencyAdmin } from "@/lib/client-access.server";
import { CLIENT_USER_ROLE } from "@/lib/client-users";
import { forbidden, parseInput } from "@/lib/http-errors.server";
import { loadDevVars } from "@/lib/load-dev-vars.server";
import {
  ACCESS_ACTION,
  ACCESS_LOG_PAGE_SIZE,
  accessActionLabel,
  pageRange,
  type AccessLogPage,
} from "@/lib/access-log";
import { clientIdOfUser, logAccess } from "@/lib/access-log.server";

// Called by the sign-in screen once the person is fully signed in (after the
// second step when they have one). Only ever records the caller's own sign-in.
export const recordSignIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await loadDevVars();
    const clientId = await clientIdOfUser(context.userId);
    logAccess({
      userId: context.userId,
      clientId,
      action: ACCESS_ACTION.signIn,
      detail: context.claims.aal === "aal2" ? "With two-step sign-in" : null,
    });
    return { ok: true };
  });

const LogQuerySchema = z.object({
  page: z.number().int().min(0).max(10_000).default(0),
  clientId: z.string().uuid().nullable().optional(),
});

export const fetchAccessLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => parseInput(LogQuerySchema)(input ?? {}))
  .handler(async ({ data, context }): Promise<AccessLogPage> => {
    await loadDevVars();
    // Agency staff see every client (and can filter); a client admin only
    // their company. Viewing as a client (fix 55) shows that client's log.
    const agency = !context.viewingClientId && (await isAgencyAdmin(context.userId));
    let clientId: string | null;
    if (context.viewingClientId) {
      clientId = context.viewingClientId;
    } else if (agency) {
      clientId = data.clientId ?? null;
    } else {
      const member = await getClientMembership(context.userId);
      if (!member || member.role !== CLIENT_USER_ROLE.clientAdmin) {
        forbidden("Only your company's admin can see the activity log");
      }
      clientId = member.clientId;
    }

    const [from, to] = pageRange(data.page);
    let query = context.supabase
      .from("access_log")
      .select(
        "id, user_id, client_id, action, claim_id, detail, created_at, claims(claim_number), clients(name, company_name)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to);
    if (clientId) query = query.eq("client_id", clientId);

    const [{ data: rows, count, error }, clientsResult] = await Promise.all([
      query,
      agency
        ? context.supabase.from("clients").select("id, name, company_name").order("name")
        : Promise.resolve(null),
    ]);
    if (error) throw new Error(`Couldn't load the activity log: ${error.message}`);

    const who = await resolveActivityAuthors(
      (rows ?? []).map((r) => r.user_id),
      { showAgencyEmails: agency },
    );
    return {
      entries: (rows ?? []).map((r) => ({
        id: r.id,
        who: r.user_id ? (who.get(r.user_id) ?? "Unknown user") : "Deleted user",
        action: r.action,
        actionLabel: accessActionLabel(r.action),
        claimId: r.claim_id,
        claimNumber: r.claims?.claim_number ?? null,
        clientName: r.clients ? r.clients.company_name || r.clients.name : null,
        detail: r.detail,
        createdAt: r.created_at,
      })),
      total: count ?? 0,
      page: data.page,
      pageSize: ACCESS_LOG_PAGE_SIZE,
      clients: clientsResult
        ? (clientsResult.data ?? []).map((c) => ({ id: c.id, name: c.company_name || c.name }))
        : null,
    };
  });

const RecordDownloadSchema = z.object({
  /** What was downloaded, in words ("Loss run 2025"). Never a file path. */
  detail: z.string().max(200),
  claimId: z.string().uuid().nullable().optional(),
});

// Files come straight from storage with a signed link, so the browser tells
// us after it asked for one. Only ever records the caller's own download, and
// not while viewing as a client.
export const recordDownload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(RecordDownloadSchema))
  .handler(async ({ data, context }) => {
    if (context.viewingClientId) return { ok: true };
    await loadDevVars();
    logAccess({
      userId: context.userId,
      clientId: await clientIdOfUser(context.userId),
      claimId: data.claimId ?? null,
      action: ACCESS_ACTION.download,
      detail: data.detail,
    });
    return { ok: true };
  });
