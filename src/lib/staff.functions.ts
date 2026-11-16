// Agency staff (logins with the agency_admin role), for "Assigned to" on the
// staff work queue (fix 52) and quick edit (fix 53). Admin only.
import { createServerFn } from "@tanstack/react-start";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadDevVars } from "@/lib/load-dev-vars.server";
import type { StaffMember } from "@/lib/staff";

export const fetchAgencyStaff = createServerFn({ method: "GET" })
  .middleware([requireAgencyAdmin])
  .handler(async (): Promise<StaffMember[]> => {
    await loadDevVars();
    const { data: roles, error } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "agency_admin");
    if (error) throw new Error(`Couldn't load staff: ${error.message}`);
    const staff = await Promise.all(
      (roles ?? []).map(async ({ user_id }) => {
        const { data } = await supabaseAdmin.auth.admin.getUserById(user_id);
        const meta = data?.user?.user_metadata?.name;
        const email = data?.user?.email ?? null;
        return {
          userId: user_id,
          name: typeof meta === "string" && meta.trim() ? meta.trim() : (email ?? "Staff member"),
          email,
        };
      }),
    );
    return staff.sort((a, b) => a.name.localeCompare(b.name));
  });
