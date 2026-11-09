import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { updateClaimWaitingOn } from "@/lib/claim-waiting-on.functions";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";
import {
  WAITING_ON_LABELS,
  WAITING_ON_VALUES,
  claimWaitingOn,
  isWaitingOn,
  waitingOnLabel,
  type WaitingOn,
} from "@/lib/waiting-on";

/**
 * "Waiting on" for a claim (fix 30). Agency admins get a dropdown that saves on
 * change; clients, and everyone on a closed claim, see the value as text.
 */
export function WaitingOnControl({
  claim,
  editable,
}: {
  claim: { id: string; status: ClaimStatus; waiting_on: WaitingOn | null };
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const updateWaitingOn = useServerFn(updateClaimWaitingOn);
  const current = claimWaitingOn(claim);

  const save = useMutation({
    mutationFn: (waitingOn: WaitingOn) =>
      updateWaitingOn({ data: { claimId: claim.id, waitingOn } }),
    onSuccess: (_result, waitingOn) => {
      toast.success(`Now waiting on ${WAITING_ON_LABELS[waitingOn].toLowerCase()}`);
      // The claim page, the claims list and Home's attention list all show it.
      queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update waiting on"),
  });

  // Closed claims have no one to wait on, so there is nothing to choose.
  if (!editable || claim.status === CLAIM_STATUS.closed) {
    return <span>{waitingOnLabel(current)}</span>;
  }

  return (
    <select
      aria-label="Waiting on"
      value={save.isPending && save.variables ? save.variables : (current ?? "")}
      disabled={save.isPending}
      onChange={(e) => {
        const value = e.target.value;
        if (isWaitingOn(value) && value !== current) save.mutate(value);
      }}
      className="h-10 w-40 rounded-md border border-input bg-background px-3 text-base md:h-9 md:text-sm disabled:opacity-60"
    >
      {current === null && (
        <option value="" disabled>
          Choose…
        </option>
      )}
      {WAITING_ON_VALUES.map((value) => (
        <option key={value} value={value}>
          {WAITING_ON_LABELS[value]}
        </option>
      ))}
    </select>
  );
}
