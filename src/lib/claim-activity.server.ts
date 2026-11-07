// Server-only: resolves who wrote each activity entry. Reads roles, clients
// and auth users with the service role and only ever returns a display name,
// so no user table is exposed to the browser.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { activityAuthorLabel, type ActivityActor } from "@/lib/claim-activity";

export async function resolveActivityAuthors(
  actorIds: readonly (string | null)[],
  { showAgencyEmails }: { showAgencyEmails: boolean },
): Promise<Map<string, string>> {
  const ids = [...new Set(actorIds.filter((id): id is string => !!id))];
  const labels = new Map<string, string>();
  if (!ids.length) return labels;

  const [{ data: admins }, { data: clients }] = await Promise.all([
    supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("user_id", ids)
      .eq("role", "agency_admin"),
    supabaseAdmin.from("clients").select("user_id, name, company_name").in("user_id", ids),
  ]);
  const adminIds = new Set((admins ?? []).map((r) => r.user_id));
  const clientNames = new Map(
    (clients ?? []).map((c) => [c.user_id as string, c.company_name || c.name]),
  );

  await Promise.all(
    ids.map(async (id) => {
      const isAgency = adminIds.has(id);
      const clientName = clientNames.get(id) ?? null;
      // Only look up the login email when it will actually be shown.
      const needsEmail = isAgency ? showAgencyEmails : !clientName;
      let email: string | null = null;
      if (needsEmail) {
        const { data } = await supabaseAdmin.auth.admin.getUserById(id);
        email = data?.user?.email ?? null;
      }
      const actor: ActivityActor | undefined =
        isAgency || clientName || email ? { isAgency, clientName, email } : undefined;
      labels.set(id, activityAuthorLabel(id, actor));
    }),
  );
  return labels;
}
