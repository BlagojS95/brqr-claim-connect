import { AlertTriangle, RotateCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { plainErrorMessage } from "@/lib/error-messages";
import { cn } from "@/lib/utils";

// Something failed to load (fix 60): what didn't load, a plain-language reason
// (never the raw server message) and a Retry button.
export function ErrorState({
  title = "This didn't load",
  error,
  onRetry,
  compact,
  className,
}: {
  /** What failed, e.g. "We couldn't load your claims". */
  title?: string;
  error?: unknown;
  /** Usually the query's refetch. Without it, no button is shown. */
  onRetry?: () => unknown;
  compact?: boolean;
  className?: string;
}) {
  const [retrying, setRetrying] = useState(false);
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-4 py-10",
        className,
      )}
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"
        aria-hidden
      >
        <AlertTriangle className="h-5 w-5" />
      </span>
      <div className="space-y-1 max-w-md">
        <p className="font-semibold text-navy">{title}</p>
        <p className="text-sm text-muted-foreground">{plainErrorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              await onRetry();
            } finally {
              setRetrying(false);
            }
          }}
        >
          <RotateCw className={cn("h-4 w-4", retrying && "animate-spin")} aria-hidden />
          Retry
        </Button>
      )}
    </div>
  );
}
