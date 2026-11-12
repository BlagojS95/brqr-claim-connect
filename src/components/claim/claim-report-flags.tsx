import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { updateClaimReportFlags } from "@/lib/claim-reserve.functions";
import { WC_CLAIM_KIND_LABELS } from "@/lib/executive-report";
import { LINE_OF_BUSINESS_NAMES } from "@/lib/line-of-business";
import type { AgencyClaim, WcClaimKind } from "@/lib/overview.types";
import { queryKeys } from "@/lib/query-keys";

const NOT_SET = "";

/**
 * Agency-only fields the executive report reads (fix 46): whether the claim
 * is in litigation and, on workers comp, lost time or medical only. Each
 * saves as soon as it changes.
 */
export function ClaimReportFlags({
  claim,
}: {
  claim: Pick<AgencyClaim, "id" | "line_of_business" | "is_litigated" | "wc_claim_kind">;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(updateClaimReportFlags);
  const isWc = claim.line_of_business === LINE_OF_BUSINESS_NAMES.WC;

  const update = useMutation({
    mutationFn: (next: { isLitigated: boolean; wcClaimKind: WcClaimKind | null }) =>
      save({ data: { claimId: claim.id, ...next } }),
    onSuccess: () => {
      toast.success("Saved");
      queryClient.invalidateQueries({ queryKey: queryKeys.claim(claim.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.overviewAll });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
  });

  const current = { isLitigated: claim.is_litigated, wcClaimKind: claim.wc_claim_kind };
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-navy"
          checked={update.isPending ? (update.variables?.isLitigated ?? false) : claim.is_litigated}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ ...current, isLitigated: e.target.checked })}
        />
        In litigation
      </label>
      {isWc && (
        <select
          aria-label="Workers comp claim kind"
          value={claim.wc_claim_kind ?? NOT_SET}
          disabled={update.isPending}
          onChange={(e) =>
            update.mutate({
              ...current,
              wcClaimKind: (e.target.value || null) as WcClaimKind | null,
            })
          }
          className="h-10 w-full max-w-[14rem] rounded-md border border-input bg-background px-3 text-base md:h-9 md:text-sm disabled:opacity-60"
        >
          <option value={NOT_SET}>Lost time or medical only?</option>
          <option value="lost_time">{WC_CLAIM_KIND_LABELS.lost_time}</option>
          <option value="medical_only">{WC_CLAIM_KIND_LABELS.medical_only}</option>
        </select>
      )}
    </div>
  );
}
