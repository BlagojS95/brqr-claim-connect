// Settings > Help for clients (fix 59), agency admins only: the default
// claims advocate shown to clients without one of their own, and the
// after-hours claims number shown to every client.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdvocateFields } from "@/components/help/advocate-fields";
import { toAdvocateDraft as toDraft, type AdvocateDraft } from "@/lib/claims-advocate";
import { fetchAdvocateDefaults, updateAdvocateDefaults } from "@/lib/claims-advocate.functions";
import { queryKeys } from "@/lib/query-keys";

const errorMessage = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

export function AdvocateSettings() {
  const queryClient = useQueryClient();
  const getDefaults = useServerFn(fetchAdvocateDefaults);
  const saveDefaults = useServerFn(updateAdvocateDefaults);
  const [draft, setDraft] = useState<AdvocateDraft>(toDraft(null));
  const [afterHours, setAfterHours] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.advocateDefaults,
    queryFn: () => getDefaults(),
  });
  useEffect(() => {
    if (!data) return;
    setDraft(toDraft(data.advocate));
    setAfterHours(data.afterHoursPhone ?? "");
  }, [data]);

  const save = useMutation({
    mutationFn: () => saveDefaults({ data: { advocate: draft, afterHoursPhone: afterHours } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.claimsAdvocateAll });
      toast.success("Help contacts saved");
    },
    onError: (e) => toast.error(errorMessage(e, "Couldn't save the help contacts")),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-destructive">
        {errorMessage(error, "Couldn't load these settings.")}
      </p>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <div className="text-sm font-medium text-foreground">Default claims advocate</div>
        <p className="text-sm text-muted-foreground mt-0.5 mb-3">
          Shown to clients that don't have their own advocate (set one per client on Admin).
        </p>
        <AdvocateFields
          idPrefix="default-advocate"
          value={draft}
          onChange={setDraft}
          disabled={save.isPending}
        />
      </div>
      <div className="border-t pt-4 space-y-1.5 sm:max-w-xs">
        <Label htmlFor="after-hours-phone">After-hours claims number</Label>
        <Input
          id="after-hours-phone"
          type="tel"
          value={afterHours}
          disabled={save.isPending}
          onChange={(e) => setAfterHours(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Shown to every client.</p>
      </div>
      <Button type="submit" className="w-full sm:w-auto" disabled={save.isPending}>
        {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Save
      </Button>
    </form>
  );
}
