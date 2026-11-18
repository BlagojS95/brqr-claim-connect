// Server-only: emails the people who asked for status change alerts (fix 48)
// after staff change a claim's status (quick edit or carrier import). Never
// throws; a failed alert must not fail the edit.
import { notifyClaimEvent, type AlertBudget } from "@/lib/claim-alerts.server";
import { buildStatusChangeEmail, statusChangeOf } from "@/lib/claim-alerts";

export async function alertStatusChange(
  claimId: string,
  changes: readonly { field: string; from: string; to: string }[],
  actorId: string,
  budget?: AlertBudget,
): Promise<void> {
  const status = statusChangeOf(changes);
  if (!status) return;
  await notifyClaimEvent({
    claimId,
    event: "status",
    actorId,
    budget,
    build: (claim, reason) =>
      buildStatusChangeEmail({ claim, from: status.from, to: status.to, reason }),
  });
}
