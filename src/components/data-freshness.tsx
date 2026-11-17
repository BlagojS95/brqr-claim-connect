import { latestCarrierUpdate, carrierUpdatedText } from "@/lib/data-freshness";

/** One line under a page's totals: when the carrier's numbers were last updated. */
export function DataFreshness({
  claims,
  className,
}: {
  claims: readonly { carrier_updated_at: string | null }[];
  className?: string;
}) {
  return (
    <p className={className ?? "text-xs text-muted-foreground"}>
      {carrierUpdatedText(latestCarrierUpdate(claims))}
    </p>
  );
}
