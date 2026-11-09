import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseInput, unprocessable } from "@/lib/http-errors.server";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { CLAIM_STATUS } from "@/lib/claim-status";
import { WAITING_ON_VALUES } from "@/lib/waiting-on";

const WaitingOnSchema = z.object({
  claimId: z.string().uuid(),
  waitingOn: z.enum(WAITING_ON_VALUES),
});

// Agency admins say who has the ball on a claim (fix 30). The role is checked
// here on the server; the update runs with the caller's own token, so RLS
// applies as well. Closed claims aren't waiting on anyone, so they're left alone.
export const updateClaimWaitingOn = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(WaitingOnSchema))
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("claims")
      .update({ waiting_on: data.waitingOn })
      .eq("id", data.claimId)
      .neq("status", CLAIM_STATUS.closed)
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated?.length) unprocessable("This claim is closed or no longer exists");
    return { ok: true };
  });
