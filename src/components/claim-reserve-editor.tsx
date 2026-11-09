import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { updateClaimRecovery, updateClaimReserve } from "@/lib/claim-reserve.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// One amount field with a Save button, shared by the reserve and recovery
// editors (agency admins only; the server functions check the role).
function AmountEditor({
  initial,
  label,
  noun,
  save: saveAmount,
}: {
  initial: number;
  label: string;
  noun: string;
  save: (amount: number) => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(String(initial));
  const amount = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(amount) && amount >= 0;

  const save = useMutation({
    mutationFn: () => saveAmount(amount),
    onSuccess: () => {
      toast.success(`${noun} updated`);
      // Totals on every page depend on it, not just this claim.
      queryClient.invalidateQueries();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : `Failed to update ${noun.toLowerCase()}`),
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
        aria-label={label}
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

export function ClaimReserveEditor({ claimId, reserve }: { claimId: string; reserve: number }) {
  const updateReserve = useServerFn(updateClaimReserve);
  return (
    <AmountEditor
      initial={reserve}
      label="Reserve amount"
      noun="Reserve"
      save={(amount) => updateReserve({ data: { claimId, reserveAmount: amount } })}
    />
  );
}

export function ClaimRecoveryEditor({ claimId, recovery }: { claimId: string; recovery: number }) {
  const updateRecovery = useServerFn(updateClaimRecovery);
  return (
    <AmountEditor
      initial={recovery}
      label="Recovery amount"
      noun="Recoveries"
      save={(amount) => updateRecovery({ data: { claimId, recoveryAmount: amount } })}
    />
  );
}
