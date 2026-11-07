import { claimStatusLabel, type ClaimStatus } from "@/lib/claim-status";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<ClaimStatus, string> = {
  notice: "bg-slate-100 text-slate-700 border-slate-300",
  submitted: "bg-gold/20 text-gold-foreground border-gold/50",
  open: "bg-navy/10 text-navy border-navy/30",
  closed: "bg-muted text-muted-foreground border-border",
  reopened: "bg-orange-100 text-orange-800 border-orange-300",
};

export function StatusBadge({ status }: { status: ClaimStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground border-border",
      )}
    >
      {claimStatusLabel(status)}
    </span>
  );
}
