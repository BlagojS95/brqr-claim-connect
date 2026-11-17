import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Loading placeholders (fix 60), shaped like what is coming so the page
// doesn't jump when it arrives. Screen readers hear `label`.
//   list:   rows of a list or table
//   card:   a grid of cards (KPI tiles, policy cards)
//   detail: a detail page (heading, fields, sections)

export type LoadingSkeletonVariant = "list" | "card" | "detail";

export function LoadingSkeleton({
  variant = "list",
  rows = 5,
  label = "Loading",
  className,
}: {
  variant?: LoadingSkeletonVariant;
  /** Rows for "list", cards for "card". */
  rows?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn("w-full", className)}>
      <span className="sr-only">{label}…</span>
      {variant === "list" && (
        <div className="space-y-3" aria-hidden>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16 hidden sm:block" />
            </div>
          ))}
        </div>
      )}
      {variant === "card" && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-5 space-y-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-7 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      )}
      {variant === "detail" && (
        <div className="space-y-6" aria-hidden>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-2/3 sm:w-1/3" />
            <Skeleton className="h-4 w-1/2 sm:w-1/4" />
          </div>
          <div className="rounded-lg border border-border bg-card p-5 grid gap-4 grid-cols-1 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-5 w-2/3" />
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-border bg-card p-5 space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      )}
    </div>
  );
}
