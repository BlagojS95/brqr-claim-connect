// View as client (fix 55): start, end and read the read-only session in which
// an agency admin sees a client's portal. The session rows are written only
// here, with the service role, after the role check on the server; they are
// also the log (who, which client, started, ended and how).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { forbidden, parseInput } from "@/lib/http-errors.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadDevVars } from "@/lib/load-dev-vars.server";
import { displayName } from "@/lib/overview.server";
import {
  VIEW_SESSION_END_REASON,
  isViewSessionOpen,
  type ViewSessionEndReason,
  type ViewingAs,
} from "@/lib/view-as";

export const startViewAsClient = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(z.object({ clientId: z.string().uuid() })))
  .handler(async ({ data, context }): Promise<ViewingAs> => {
    await loadDevVars();
    const { data: client, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("id, name, company_name")
      .eq("id", data.clientId)
      .maybeSingle();
    if (clientError) throw new Error(`Couldn't load the client: ${clientError.message}`);
    if (!client) forbidden("That client doesn't exist");

    // Close whatever is still open for this admin (an expired session keeps
    // ended_at empty until now). An unexpired one can't be open here: this
    // function is refused while viewing, so the admin has to exit first.
    const now = new Date();
    const { data: open, error: openError } = await supabaseAdmin
      .from("admin_view_sessions")
      .select("id, started_at, ended_at")
      .eq("admin_id", context.userId)
      .is("ended_at", null);
    if (openError) throw new Error(`Couldn't start viewing: ${openError.message}`);
    for (const s of open ?? []) {
      const reason = isViewSessionOpen(s, now)
        ? VIEW_SESSION_END_REASON.replaced
        : VIEW_SESSION_END_REASON.expired;
      await supabaseAdmin
        .from("admin_view_sessions")
        .update({ ended_at: now.toISOString(), ended_reason: reason })
        .eq("id", s.id)
        .is("ended_at", null);
    }

    const { error } = await supabaseAdmin
      .from("admin_view_sessions")
      .insert({ admin_id: context.userId, client_id: client.id });
    if (error) throw new Error(`Couldn't start viewing: ${error.message}`);
    console.info(`[view-as] start admin=${context.userId} client=${client.id}`);
    return { clientId: client.id, clientName: displayName(client) };
  });

// Allowed while viewing (it is how you get out). Only ever closes the caller's
// own sessions; for anyone without one it changes nothing.
export const endViewAsClient = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator((input) =>
    parseInput(
      z.object({
        reason: z
          .enum([VIEW_SESSION_END_REASON.exit, VIEW_SESSION_END_REASON.signOut])
          .default(VIEW_SESSION_END_REASON.exit),
      }),
    )(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await loadDevVars();
    const reason: ViewSessionEndReason = data.reason;
    const { data: ended, error } = await supabaseAdmin
      .from("admin_view_sessions")
      .update({ ended_at: new Date().toISOString(), ended_reason: reason })
      .eq("admin_id", context.userId)
      .is("ended_at", null)
      .select("id, client_id");
    if (error) throw new Error(`Couldn't stop viewing: ${error.message}`);
    for (const s of ended ?? []) {
      console.info(`[view-as] end admin=${context.userId} client=${s.client_id} reason=${reason}`);
    }
    return { ended: ended?.length ?? 0 };
  });

// The session the caller is in, if any, for the banner. The client id comes
// from the database check in requireSupabaseAuth, never from the browser.
export const fetchViewAsSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ViewingAs | null> => {
    const clientId = context.viewingClientId;
    if (!clientId) return null;
    const { data: client } = await context.supabase
      .from("clients")
      .select("name, company_name")
      .eq("id", clientId)
      .maybeSingle();
    return { clientId, clientName: displayName(client) };
  });

export interface ViewSessionLogEntry {
  id: string;
  adminName: string;
  clientName: string;
  startedAt: string;
  endedAt: string | null;
  endedReason: ViewSessionEndReason | null;
}

// The "View-as-client log" card on /admin: the last 20 sessions. Rows are read
// with the caller's token (RLS: agency staff only); staff emails with the
// service role, as fetchAgencyStaff does.
export const listViewAsSessions = createServerFn({ method: "GET" })
  .middleware([requireAgencyAdmin])
  .handler(async ({ context }): Promise<ViewSessionLogEntry[]> => {
    await loadDevVars();
    const { data: rows, error } = await context.supabase
      .from("admin_view_sessions")
      .select("id, admin_id, started_at, ended_at, ended_reason, clients(name, company_name)")
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(`Couldn't load the view-as-client log: ${error.message}`);

    const adminIds = [...new Set((rows ?? []).map((r) => r.admin_id))];
    const names = new Map<string, string>();
    await Promise.all(
      adminIds.map(async (id) => {
        const { data } = await supabaseAdmin.auth.admin.getUserById(id);
        const meta = data?.user?.user_metadata?.name;
        names.set(
          id,
          typeof meta === "string" && meta.trim()
            ? meta.trim()
            : (data?.user?.email ?? "Staff member"),
        );
      }),
    );

    return (rows ?? []).map((r) => ({
      id: r.id,
      adminName: names.get(r.admin_id) ?? "Staff member",
      clientName: displayName(r.clients),
      startedAt: r.started_at,
      endedAt: r.ended_at,
      endedReason: (r.ended_reason as ViewSessionEndReason | null) ?? null,
    }));
  });
