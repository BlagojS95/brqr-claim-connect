import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { httpError, parseInput } from "@/lib/http-errors.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  SavedViewFiltersSchema,
  ViewNameSchema,
  searchFromViewFilters,
  type SavedView,
} from "@/lib/saved-views";

// Saved views on the claims list (fix 31). Every query runs with the caller's
// own token: the saved_claim_views RLS policy limits each user to their own
// rows, and user_id defaults to auth.uid(), so nothing here trusts the browser
// for whose view it is.

// Postgres unique_violation: the user already has a view with this name.
const UNIQUE_VIOLATION = "23505";

function toSavedView(row: {
  id: string;
  name: string;
  filters: unknown;
  created_at: string;
}): SavedView {
  return {
    id: row.id,
    name: row.name,
    filters: searchFromViewFilters(row.filters),
    created_at: row.created_at,
  };
}

export const listSavedViews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SavedView[]> => {
    const { data, error } = await context.supabase
      .from("saved_claim_views")
      .select("id, name, filters, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toSavedView);
  });

const CreateSchema = z.object({
  name: ViewNameSchema,
  filters: SavedViewFiltersSchema,
});

export const createSavedView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(CreateSchema))
  .handler(async ({ data, context }): Promise<SavedView> => {
    const { data: row, error } = await context.supabase
      .from("saved_claim_views")
      .insert({ name: data.name, filters: data.filters })
      .select("id, name, filters, created_at")
      .single();
    if (error?.code === UNIQUE_VIOLATION) {
      httpError(409, `You already have a view called "${data.name}". Pick another name.`);
    }
    if (error || !row) throw new Error(error?.message ?? "Could not save the view");
    return toSavedView(row);
  });

const DeleteSchema = z.object({ viewId: z.string().uuid() });

export const deleteSavedView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(DeleteSchema))
  .handler(async ({ data, context }) => {
    const { data: deleted, error } = await context.supabase
      .from("saved_claim_views")
      .delete()
      .eq("id", data.viewId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!deleted?.length) httpError(404, "This view no longer exists");
    return { ok: true };
  });
