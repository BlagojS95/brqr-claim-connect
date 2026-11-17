import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { fetchClaimResponseTimes } from "@/lib/response-targets.functions";
import { PastTargetBadge } from "@/components/staff/past-target-badge";

/**
 * "Response times" on claim detail (fix 56), for agency staff only: business
 * days to submit to the carrier and to the carrier's first contact. Under the
 * claim's own query key, so anything that refreshes the claim refreshes this.
 */
export function ClaimResponseTimes({ claimId }: { claimId: string }) {
  const getTimes = useServerFn(fetchClaimResponseTimes);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["claim", claimId, "response-times"],
    queryFn: () => getTimes({ data: { claimId } }),
  });

  if (isLoading) return <span className="text-muted-foreground">Loading…</span>;
  if (isError || !data) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{data.lines.join(" · ")}</span>
      {data.times.pastTarget && <PastTargetBadge />}
    </span>
  );
}
