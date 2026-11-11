// Server-only: resolves who wrote each activity entry. Reads roles, client
// users and auth users with the service role and only ever returns a display
// name, so no user table is exposed to the browser.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { activityAuthorLabel, type ActivityActor } from "@/lib/claim-activity";

export async function resolveActivityAuthors(
  actorIds: readonly (string | null)[],
  { showAgencyEmails }: { showAgencyEmails: boolean },
): Promise<Map<string, string>> {
  const ids = [...new Set(actorIds.filter((id): id is string => !!id))];
  const labels = new Map<string, string>();
  if (!ids.length) return labels;

  const [{ data: admins }, { data: members }] = await Promise.all([
    supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("user_id", ids)
      .eq("role", "agency_admin"),
    // Every login of a company (fix 32), not just its first one.
    supabaseAdmin
      .from("client_users")
      .select("user_id, clients(name, company_name)")
      .in("user_id", ids),
  ]);
  const adminIds = new Set((admins ?? []).map((r) => r.user_id));
  const clientNames = new Map(
    (members ?? []).map((m) => [m.user_id, m.clients?.company_name || m.clients?.name || null]),
  );

  await Promise.all(
    ids.map(async (id) => {
      const isAgency = adminIds.has(id);
      const clientName = clientNames.get(id) ?? null;
      // Only look up the login when it will actually be shown: agency emails
      // for admins, and the person's name or email for client users.
      const needsUser = isAgency ? showAgencyEmails : true;
      let email: string | null = null;
      let userName: string | null = null;
      if (needsUser) {
        const { data } = await supabaseAdmin.auth.admin.getUserById(id);
        email = data?.user?.email ?? null;
        const metaName = data?.user?.user_metadata?.name;
        userName = !isAgency && typeof metaName === "string" ? metaName : null;
      }
      const actor: ActivityActor | undefined =
        isAgency || clientName || email ? { isAgency, clientName, email, userName } : undefined;
      labels.set(id, activityAuthorLabel(id, actor));
    }),
  );
  return labels;
}
