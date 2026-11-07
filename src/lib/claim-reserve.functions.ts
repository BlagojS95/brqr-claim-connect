import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseInput } from "@/lib/http-errors.server";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";

const ReserveSchema = z.object({
  claimId: z.string().uuid(),
  reserveAmount: z.number().min(0).max(999_999_999_999),
});

export const updateClaimReserve = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(ReserveSchema))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("claims")
      .update({ reserve_amount: data.reserveAmount })
      .eq("id", data.claimId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
