// Settings > Security (fix 51): whether a company requires two-step sign-in.
//
// clients.require_mfa is written only here, with the service role, after
// checking on the server that the caller is that client's client_admin or
// agency staff. Enrolling and verifying an authenticator app go straight from
// the browser to Supabase Auth (it's the user's own account), not through here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getClientMembership, isAgencyAdmin } from "@/lib/client-access.server";
import { CLIENT_USER_ROLE } from "@/lib/client-users";
import { forbidden, parseInput, unprocessable } from "@/lib/http-errors.server";
import { loadDevVars } from "@/lib/load-dev-vars.server";
import type { ClientMfaSetting, MfaStatus, SecuritySettings } from "@/lib/mfa";
import { mfaRequiredFor } from "@/lib/mfa.server";

const ONLY_ADMINS = "Only your company's admin can change this";

function clientName(row: { name: string; company_name: string | null }): string {
  return row.company_name || row.name;
}

// Called by the sign-in screen and the /_app guard before the second step, so
// it is the one function exempt from the two-step check (src/lib/mfa.ts).
export const fetchMfaStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MfaStatus> => {
    return { required: await mfaRequiredFor(context.supabase, context.userId) };
  });

export const fetchSecuritySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SecuritySettings> => {
    await loadDevVars();
    // Viewing as a client (fix 55): the setting as that client's admin sees it.
    if (context.viewingClientId) {
      const { data } = await supabaseAdmin
        .from("clients")
        .select("id, name, company_name, require_mfa")
        .eq("id", context.viewingClientId)
        .maybeSingle();
      return {
        manage: "client",
        clients: data
          ? [{ clientId: data.id, clientName: clientName(data), requireMfa: data.require_mfa }]
          : [],
      };
    }
    if (await isAgencyAdmin(context.userId)) {
      const { data, error } = await supabaseAdmin
        .from("clients")
        .select("id, name, company_name, require_mfa")
        .order("name");
      if (error) throw new Error(`Couldn't load clients: ${error.message}`);
      const clients: ClientMfaSetting[] = (data ?? []).map((c) => ({
        clientId: c.id,
        clientName: clientName(c),
        requireMfa: c.require_mfa,
      }));
      return { manage: "agency", clients };
    }
    const member = await getClientMembership(context.userId);
    if (!member || member.role !== CLIENT_USER_ROLE.clientAdmin) {
      return { manage: null, clients: [] };
    }
    const { data, error } = await supabaseAdmin
      .from("clients")
      .select("id, name, company_name, require_mfa")
      .eq("id", member.clientId)
      .single();
    if (error) throw new Error(`Couldn't load your company: ${error.message}`);
    return {
      manage: "client",
      clients: [{ clientId: data.id, clientName: clientName(data), requireMfa: data.require_mfa }],
    };
  });

const RequireMfaSchema = z.object({
  clientId: z.string().uuid(),
  required: z.boolean(),
});

export const setClientRequireMfa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(RequireMfaSchema))
  .handler(async ({ data, context }) => {
    await loadDevVars();
    const agency = await isAgencyAdmin(context.userId);
    if (!agency) {
      const member = await getClientMembership(context.userId);
      if (
        !member ||
        member.role !== CLIENT_USER_ROLE.clientAdmin ||
        member.clientId !== data.clientId
      ) {
        forbidden(ONLY_ADMINS);
      }
      // So the admin can't lock themselves out: they must be using it already.
      if (data.required && context.claims.aal !== "aal2") {
        unprocessable("Set up two-step sign-in for yourself first, then turn this on");
      }
    }
    const { data: updated, error } = await supabaseAdmin
      .from("clients")
      .update({ require_mfa: data.required })
      .eq("id", data.clientId)
      .select("id");
    if (error) throw new Error(`Couldn't save the setting: ${error.message}`);
    if (!updated?.length) forbidden(ONLY_ADMINS);
    return { required: data.required };
  });
