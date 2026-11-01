import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { updateClaimReserve } from "@/lib/claim-reserve.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ClaimReserveEditor({ claimId, reserve }: { claimId: string; reserve: number }) {
  const queryClient = useQueryClient();
  const updateReserve = useServerFn(updateClaimReserve);
  const [value, setValue] = useState(String(reserve));
  const amount = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(amount) && amount >= 0;

  const save = useMutation({
    mutationFn: () => updateReserve({ data: { claimId, reserveAmount: amount } }),
    onSuccess: () => {
      toast.success("Reserve updated");
      // Totals on every page depend on it, not just this claim.
      queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update reserve"),
  });

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <Input
        type="number"
        min={0}
        step="0.01"
        aria-label="Reserve amount"
        className="w-40"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" size="sm" variant="outline" disabled={!valid || save.isPending}>
        {save.isPending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
