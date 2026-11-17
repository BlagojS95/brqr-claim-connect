import { claimStatusLabel, type ClaimStatus } from "@/lib/claim-status";
import { statusColor } from "@/lib/status-colors";
import { cn } from "@/lib/utils";
import { GlossaryHoverTip, GlossaryTip } from "@/components/glossary-tip";

/**
 * A claim status with its plain-English explanation (fix 49). Inside a link
 * pass `inLink`: the explanation then shows on hover only, so the link has no
 * second control in it (the claim page has the tappable version).
 */
export function StatusBadge({ status, inLink = false }: { status: ClaimStatus; inLink?: boolean }) {
  const badge = (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
        statusColor(status).badge,
      )}
    >
      {claimStatusLabel(status)}
    </span>
  );
  if (inLink) return <GlossaryHoverTip status={status}>{badge}</GlossaryHoverTip>;
  return (
    <GlossaryTip status={status} label={`Status: ${claimStatusLabel(status)}. What this means`}>
      {badge}
    </GlossaryTip>
  );
}
