import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "./auth-middleware";
import { forbidden } from "@/lib/http-errors.server";

export const requireAgencyAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "agency_admin")
      .maybeSingle();

    // Signed in but not an admin: 403. Same message the toasts showed before.
    if (!data) forbidden("Unauthorized: agency_admin role required");

    return next();
  });
