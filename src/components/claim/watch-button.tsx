import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { fetchWatchedClaimIds, setClaimWatch } from "@/lib/claim-watches.functions";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

// Watch toggle (fix 48): a watched claim sends the signed-in user email alerts
// for the kinds they chose in Settings. One shared query serves every button
// on a page.
export function WatchButton({
  claimId,
  claimLabel,
  showLabel = false,
  className,
}: {
  claimId: string;
  /** For the screen reader, e.g. "claim 123-ABC". */
  claimLabel?: string;
  showLabel?: boolean;
  className?: string;
}) {
  const { viewingAs } = useAuth();
  const queryClient = useQueryClient();
  const getWatched = useServerFn(fetchWatchedClaimIds);
  const setWatch = useServerFn(setClaimWatch);
  const { data: watched, isLoading } = useQuery({
    queryKey: queryKeys.watchedClaims,
    queryFn: () => getWatched(),
  });
  const isWatching = !!watched?.includes(claimId);

  const toggle = useMutation({
    mutationFn: (watching: boolean) => setWatch({ data: { claimId, watching } }),
    onSuccess: (_res, watching) => {
      queryClient.setQueryData<string[]>(queryKeys.watchedClaims, (prev = []) =>
        watching ? [...new Set([...prev, claimId])] : prev.filter((id) => id !== claimId),
      );
      toast.success(watching ? "You're watching this claim" : "You stopped watching this claim");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't change the watch setting"),
  });

  const name = claimLabel ?? "this claim";
  const label = isWatching ? `Stop watching ${name}` : `Watch ${name}`;
  const Icon = isWatching ? Eye : EyeOff;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isWatching}
      title={label}
      disabled={isLoading || toggle.isPending || !!viewingAs}
      onClick={() => toggle.mutate(!isWatching)}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md px-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        isWatching ? "text-gold" : "text-muted-foreground",
        className,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {showLabel && <span>{isWatching ? "Watching" : "Watch"}</span>}
    </button>
  );
}
