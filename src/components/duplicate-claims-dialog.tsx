import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
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
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/dates";
import type { DuplicateMatch } from "@/lib/duplicate-claims";

// Shown by the report form when the caller already has a claim that looks
// like the same loss (fix 38). Nothing is saved until "Report anyway".
export function DuplicateClaimsDialog({
  duplicates,
  onReportAnyway,
  onCancel,
}: {
  duplicates: DuplicateMatch[] | null;
  onReportAnyway: () => void;
  onCancel: () => void;
}) {
  const count = duplicates?.length ?? 0;
  return (
    <AlertDialog open={count > 0} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-navy">
            {count === 1 ? "This may already be reported" : "These may already be reported"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {count === 1 ? "A claim" : `${count} claims`} with the same date of loss, line of
            business and person or vehicle {count === 1 ? "is" : "are"} already on file. Check{" "}
            {count === 1 ? "it" : "them"} before reporting again.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="space-y-2">
          {duplicates?.map((claim) => (
            <li key={claim.id}>
              <Link
                to="/claims/$claimId"
                params={{ claimId: claim.id }}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start justify-between gap-3 rounded-md border border-border p-3 hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <div className="font-medium text-navy break-words">
                    {claim.claim_number || (
                      <span className="italic text-muted-foreground">Number pending</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground break-words">
                    {claim.claim_type} · {formatDate(claim.date_of_loss)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={claim.status} />
                  <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onReportAnyway}
            className="bg-navy hover:bg-navy/90 text-navy-foreground"
          >
            Report anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
