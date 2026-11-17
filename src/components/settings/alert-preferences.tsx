import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { fetchAlertPrefs, updateAlertPref } from "@/lib/claim-watches.functions";
import {
  ALERT_EVENTS,
  ALERT_EVENT_LABELS,
  type AlertEvent,
  type AlertPrefs,
} from "@/lib/claim-alerts";
import { queryKeys } from "@/lib/query-keys";

const EVENT_HELP: Record<AlertEvent, string> = {
  status: "When a claim's status changes.",
  messages: "When someone posts a message. You are always emailed when you are @mentioned.",
  documents: "When a document is requested on a claim.",
};

// Claim alerts (fix 48), shown next to the weekly digest switch in Settings.
// Each kind of alert can go to claims you watch and/or to every claim you can see.
export function AlertPreferences({ disabled }: { disabled?: boolean }) {
  const queryClient = useQueryClient();
  const getPrefs = useServerFn(fetchAlertPrefs);
  const savePref = useServerFn(updateAlertPref);
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.alertPrefs,
    queryFn: () => getPrefs(),
  });

  const save = useMutation({
    mutationFn: (v: { event: AlertEvent; scope: "watched" | "all"; enabled: boolean }) =>
      savePref({ data: v }),
    onSuccess: (_res, v) =>
      queryClient.setQueryData<AlertPrefs>(queryKeys.alertPrefs, (prev) =>
        prev ? { ...prev, [v.event]: { ...prev[v.event], [v.scope]: v.enabled } } : prev,
      ),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't save your setting"),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading claim alerts…</p>;
  if (error || !data) {
    return <p className="text-sm text-destructive">Couldn't load your claim alert settings.</p>;
  }

  return (
    <div className="border-t pt-4">
      <div className="text-sm font-medium text-foreground">Claim alerts</div>
      <p className="text-sm text-muted-foreground mt-0.5">
        Watch a claim (the eye icon on the claim or in the claims list) to get emails about it. Or
        ask for every claim you can see.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                Email me about
              </th>
              <th scope="col" className="py-2 px-3 font-medium text-center">
                Watched claims
              </th>
              <th scope="col" className="py-2 pl-3 font-medium text-center">
                All claims
              </th>
            </tr>
          </thead>
          <tbody>
            {ALERT_EVENTS.map((event) => (
              <tr key={event} className="border-t border-border align-top">
                <th scope="row" className="py-3 pr-3 text-left font-normal">
                  <span className="font-medium text-foreground">{ALERT_EVENT_LABELS[event]}</span>
                  <span className="block text-muted-foreground">{EVENT_HELP[event]}</span>
                </th>
                {(["watched", "all"] as const).map((scope) => (
                  <td key={scope} className="py-3 px-3 text-center">
                    <Switch
                      aria-label={`${ALERT_EVENT_LABELS[event]}, ${scope === "watched" ? "watched claims" : "all claims"}`}
                      checked={data[event][scope]}
                      disabled={disabled || save.isPending}
                      onCheckedChange={(enabled) => save.mutate({ event, scope, enabled })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
