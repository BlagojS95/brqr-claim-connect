// Who a signed-in client user is within their company (fix 32). Read with the
// service role from client_users, which only server code may write, so the
// browser can't claim a role or locations it doesn't have.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ClientUserRole } from "@/lib/client-users";

export interface ClientMembership {
  clientId: string;
  role: ClientUserRole;
  /** Only set for a location user. */
  locationIds: string[];
}

export async function getClientMembership(userId: string): Promise<ClientMembership | null> {
  const { data, error } = await supabaseAdmin
    .from("client_users")
    .select("client_id, role, location_ids")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't check your account: ${error.message}`);
  if (!data) return null;
  return { clientId: data.client_id, role: data.role, locationIds: data.location_ids ?? [] };
}

export async function isAgencyAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "agency_admin")
    .maybeSingle();
  return !!data;
}
