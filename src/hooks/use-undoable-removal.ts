import { useCallback, useState } from "react";
import { toast } from "sonner";

export const UNDO_WINDOW_MS = 8000;

// Undo for a removal (fix 60). The item disappears from the page and a toast
// offers "Undo" for 8 seconds; the real delete only runs after that window,
// so Undo never has to bring anything back from the database or storage.
// If the page is closed or reloaded during the window, the delete never runs
// and the item is still there: the safe failure.
export function useUndoableRemoval<T extends { id: string }>({
  message,
  commit,
  onSettled,
}: {
  message: (item: T) => string;
  /** The real delete. Runs once, after the undo window, unless undone. */
  commit: (item: T) => Promise<void>;
  /** Refresh the list after the delete finished or failed. */
  onSettled?: () => void;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const setHiddenId = useCallback((id: string, isHidden: boolean) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (isHidden) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const remove = useCallback(
    (item: T) => {
      setHiddenId(item.id, true);
      const timer = setTimeout(async () => {
        try {
          await commit(item);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't remove it");
        } finally {
          setHiddenId(item.id, false);
          onSettled?.();
        }
      }, UNDO_WINDOW_MS);
      toast(message(item), {
        duration: UNDO_WINDOW_MS,
        action: {
          label: "Undo",
          onClick: () => {
            clearTimeout(timer);
            setHiddenId(item.id, false);
          },
        },
      });
    },
    [commit, message, onSettled, setHiddenId],
  );

  return { hiddenIds: hidden, remove };
}
