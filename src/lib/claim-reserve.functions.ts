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

const RecoverySchema = z.object({
  claimId: z.string().uuid(),
  recoveryAmount: z.number().min(0, "Recoveries can't be negative").max(999_999_999_999),
});

// Recoveries (subrogation, salvage) sit beside the reserve: agency staff only.
// Net incurred is worked out from it in src/lib/claim-metrics.ts.
export const updateClaimRecovery = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(RecoverySchema))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("claims")
      .update({ recovery_amount: data.recoveryAmount })
      .eq("id", data.claimId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
