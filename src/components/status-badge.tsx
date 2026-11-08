import { claimStatusLabel, type ClaimStatus } from "@/lib/claim-status";
import { statusColor } from "@/lib/status-colors";
import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: ClaimStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
        statusColor(status).badge,
      )}
    >
      {claimStatusLabel(status)}
    </span>
  );
}
