import { CheckCircle2, RotateCcw } from "lucide-react";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";
import { netIncurred, paidAmount, recoveryAmount } from "@/lib/claim-metrics";
import { formatDate } from "@/lib/dates";
import { statusColor } from "@/lib/status-colors";
import { cn } from "@/lib/utils";

interface OutcomeClaim {
  status: ClaimStatus;
  closed_date: string | null;
  paid_amount: number | null;
  reserve_amount: number | null;
  recovery_amount: number | null;
}

const money = (n: number) => `$${n.toLocaleString()}`;

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold text-navy">{value}</div>
    </div>
  );
}

/**
 * Where the claim ended up. Closed: a summary of what was paid, recovered and
 * the net cost. Reopened: a note that a closed claim is being worked again
 * (the header badge shows the status; the activity log has the change).
 * Nothing for claims still in progress.
 */
export function ClaimOutcome({ claim }: { claim: OutcomeClaim }) {
  if (claim.status === CLAIM_STATUS.reopened) {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border p-4 text-sm",
          statusColor(CLAIM_STATUS.reopened).badge,
        )}
      >
        <RotateCcw className="h-4 w-4 mt-0.5 shrink-0" />
        <p>
          <span className="font-semibold">Reopened.</span> This claim was closed
          {claim.closed_date ? ` on ${formatDate(claim.closed_date)}` : ""} and is being worked
          again.
        </p>
      </div>
    );
  }

  if (claim.status !== CLAIM_STATUS.closed) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <h2 className="font-semibold text-navy mb-4 inline-flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-muted-foreground" /> Closed Claim Summary
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        <Figure label="Final Paid" value={money(paidAmount(claim))} />
        <Figure label="Recoveries" value={money(recoveryAmount(claim))} />
        <Figure label="Net Incurred" value={money(netIncurred(claim))} />
        <Figure label="Closed" value={formatDate(claim.closed_date)} />
      </div>
    </section>
  );
}
