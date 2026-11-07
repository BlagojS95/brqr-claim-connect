import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseInput } from "@/lib/http-errors.server";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";

const SaveNoteSchema = z.object({
  claimId: z.string().uuid(),
  body: z.string().max(20_000, "Internal notes can be at most 20,000 characters"),
});

// Save the claim's internal note (agency staff only). The author is taken from
// the verified token, not from the browser.
export const saveClaimInternalNote = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(SaveNoteSchema))
  .handler(async ({ data, context }) => {
    const email = typeof context.claims.email === "string" ? context.claims.email : null;
    const { error } = await context.supabase.from("claim_internal_notes").upsert({
      claim_id: data.claimId,
      body: data.body,
      updated_by: context.userId,
      updated_by_email: email,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
