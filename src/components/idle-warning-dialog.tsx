// Fix 51: shown 2 minutes before the 30-minute idle sign-out. The countdown
// comes from the shared localStorage times (src/lib/session-expiry.ts), so
// activity in any tab closes it in every tab.
import { Clock } from "lucide-react";
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
import { formatCountdown } from "@/lib/session-expiry";

export function IdleWarningDialog({
  msLeft,
  onStay,
  onSignOut,
}: {
  /** Null hides the dialog. */
  msLeft: number | null;
  onStay: () => void;
  onSignOut: () => void;
}) {
  // Open is driven only by msLeft: "Stay signed in" records activity, which
  // makes msLeft null in every tab on the next tick.
  return (
    <AlertDialog open={msLeft !== null}>
      <AlertDialogContent
        className="max-w-[calc(100vw-2rem)] sm:max-w-md"
        // Escape counts as "stay": the person is clearly there.
        onEscapeKeyDown={onStay}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-navy">
            <Clock className="h-5 w-5" aria-hidden="true" /> Still there?
          </AlertDialogTitle>
          <AlertDialogDescription aria-live="polite">
            You'll be signed out in{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {formatCountdown(msLeft ?? 0)}
            </span>{" "}
            for inactivity.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel onClick={onSignOut}>Sign out</AlertDialogCancel>
          <AlertDialogAction
            onClick={onStay}
            className="bg-navy hover:bg-navy/90 text-navy-foreground"
          >
            Stay signed in
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
