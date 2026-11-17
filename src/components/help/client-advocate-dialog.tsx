// Edit one client's claims advocate on /admin (fix 59). Blank fields mean the
// client sees the agency default advocate from Settings.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LifeBuoy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AdvocateFields } from "@/components/help/advocate-fields";
import { toAdvocateDraft as toDraft, type AdvocateDraft } from "@/lib/claims-advocate";
import { fetchClientAdvocate, updateClientAdvocate } from "@/lib/claims-advocate.functions";
import { queryKeys } from "@/lib/query-keys";

const errorMessage = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

export function ClientAdvocateDialog({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const getAdvocate = useServerFn(fetchClientAdvocate);
  const saveAdvocate = useServerFn(updateClientAdvocate);
  const [draft, setDraft] = useState<AdvocateDraft>(toDraft(null));

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.clientAdvocate(clientId),
    queryFn: () => getAdvocate({ data: { clientId } }),
    enabled: open,
  });
  useEffect(() => {
    if (open && data) setDraft(toDraft(data));
  }, [open, data]);

  const save = useMutation({
    mutationFn: () => saveAdvocate({ data: { clientId, advocate: draft } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.claimsAdvocateAll });
      toast.success("Claims advocate saved");
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e, "Couldn't save the claims advocate")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" aria-label={`Claims advocate for ${clientName}`}>
          <LifeBuoy className="h-3.5 w-3.5 mr-1" aria-hidden /> Advocate
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Claims advocate</DialogTitle>
          <DialogDescription>
            Shown to {clientName} in the sidebar and the Help menu. Leave all fields blank to show
            the agency default from Settings.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">
            {errorMessage(error, "Couldn't load the claims advocate.")}
          </p>
        ) : (
          <AdvocateFields
            idPrefix={`advocate-${clientId}`}
            value={draft}
            onChange={setDraft}
            disabled={save.isPending}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || isLoading || !!error}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
