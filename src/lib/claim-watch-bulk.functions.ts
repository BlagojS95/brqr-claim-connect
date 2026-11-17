import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseInput } from "@/lib/http-errors.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_BULK_CLAIMS } from "@/lib/claims-table";

// Bulk "Watch" on the claims list (fix 50). Same table as the single Watch
// button (claim_watches, fix 48), written with the caller's own token: RLS
// only lets a user watch for themselves and only claims they can see, so an
// id from another client is refused rather than trusted. Watching a claim
// that is already watched is not an error.

const BulkWatchSchema = z.object({
  claimIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_CLAIMS),
});

export const watchClaimsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(BulkWatchSchema))
  .handler(async ({ data, context }): Promise<{ watched: number }> => {
    const claimIds = [...new Set(data.claimIds)];
    const { error } = await context.supabase.from("claim_watches").upsert(
      claimIds.map((claim_id) => ({ user_id: context.userId, claim_id })),
      { onConflict: "user_id,claim_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
    return { watched: claimIds.length };
  });
