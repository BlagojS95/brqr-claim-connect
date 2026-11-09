import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, X } from "lucide-react";
import { toast } from "sonner";
import type { ClaimsSearch } from "@/lib/claims-list";
import { queryKeys } from "@/lib/query-keys";
import {
  MAX_VIEW_NAME_LENGTH,
  ViewNameSchema,
  activeViewId,
  isUnfiltered,
  viewFiltersFromSearch,
  type SavedView,
  type SavedViewFilters,
} from "@/lib/saved-views";
import { createSavedView, deleteSavedView, listSavedViews } from "@/lib/saved-views.functions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const errorMessage = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

/**
 * The saved views row above the claims list (fix 31): "All claims" first,
 * then the user's own views as chips. Clicking one applies its search; the
 * one matching the URL is highlighted. Scrolls sideways on phones.
 */
export function SavedViewsBar({
  search,
  onApply,
}: {
  search: ClaimsSearch;
  onApply: (filters: SavedViewFilters) => void;
}) {
  const queryClient = useQueryClient();
  const getViews = useServerFn(listSavedViews);
  const createView = useServerFn(createSavedView);
  const deleteView = useServerFn(deleteSavedView);

  const { data: views = [] } = useQuery({
    queryKey: queryKeys.savedClaimViews,
    queryFn: () => getViews(),
  });

  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SavedView | null>(null);

  const save = useMutation({
    mutationFn: (viewName: string) =>
      createView({ data: { name: viewName, filters: viewFiltersFromSearch(search) } }),
    onSuccess: (view) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.savedClaimViews });
      toast.success(`Saved "${view.name}"`);
      setSaveOpen(false);
      setName("");
    },
    onError: (e) => setNameError(errorMessage(e, "Could not save the view")),
  });

  const remove = useMutation({
    mutationFn: (view: SavedView) => deleteView({ data: { viewId: view.id } }),
    onSuccess: (_result, view) => toast.success(`Deleted "${view.name}"`),
    onError: (e) => toast.error(errorMessage(e, "Could not delete the view")),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.savedClaimViews });
      setPendingDelete(null);
    },
  });

  const activeId = activeViewId(views, search);
  const allActive = activeId === null && isUnfiltered(search);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ViewNameSchema.safeParse(name);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? "Give the view a name");
      return;
    }
    setNameError(null);
    save.mutate(parsed.data);
  };

  const chipClass = (active: boolean) =>
    cn(
      "inline-flex items-center h-8 rounded-full border text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "bg-navy border-navy text-navy-foreground"
        : "bg-card border-border text-foreground hover:bg-muted/50",
    );

  return (
    <div className="flex items-center gap-2">
      <div
        role="list"
        aria-label="Saved views"
        className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto md:flex-wrap md:overflow-visible pb-1 -mb-1"
      >
        <div role="listitem" className="shrink-0">
          <button
            type="button"
            className={cn(chipClass(allActive), "px-3")}
            aria-pressed={allActive}
            onClick={() => onApply({})}
          >
            All claims
          </button>
        </div>
        {views.map((view) => {
          const active = view.id === activeId;
          return (
            <div key={view.id} role="listitem" className={cn(chipClass(active), "shrink-0")}>
              <button
                type="button"
                className="h-full pl-3 pr-1 rounded-l-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-w-48 truncate"
                aria-pressed={active}
                onClick={() => onApply(view.filters)}
                title={view.name}
              >
                {view.name}
              </button>
              <button
                type="button"
                className={cn(
                  "h-full px-2 rounded-r-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "hover:bg-navy-foreground/10" : "hover:bg-muted",
                )}
                aria-label={`Delete view ${view.name}`}
                onClick={() => setPendingDelete(view)}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => {
          setName("");
          setNameError(null);
          setSaveOpen(true);
        }}
      >
        <Bookmark className="h-4 w-4" aria-hidden />
        Save view
      </Button>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="text-navy">Save view</DialogTitle>
              <DialogDescription>
                Saves the current search, filters and sort as a tab above the list.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <label htmlFor="saved-view-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="saved-view-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
                maxLength={MAX_VIEW_NAME_LENGTH}
                placeholder="e.g. Open auto claims"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "saved-view-name-error" : undefined}
                autoFocus
              />
              {nameError && (
                <p id="saved-view-name-error" role="alert" className="text-sm text-destructive">
                  {nameError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSaveOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-navy hover:bg-navy/90 text-navy-foreground"
                disabled={save.isPending}
              >
                {save.isPending ? "Saving…" : "Save view"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this view?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingDelete?.name}" will be removed from your saved views. Your claims are not
              affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) remove.mutate(pendingDelete);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
