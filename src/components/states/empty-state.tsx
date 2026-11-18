import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// "Nothing here yet" (fix 60): an icon, a title, one line on why, and the
// next thing to do (a Button or Link passed as `action`).
export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
  compact,
  className,
}: {
  icon: LucideIcon;
  title: string;
  text?: ReactNode;
  action?: ReactNode;
  /** Less padding, for inside a table or a small card. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-4 py-10",
        className,
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full bg-muted text-navy",
          compact ? "h-10 w-10" : "h-12 w-12",
        )}
        aria-hidden
      >
        <Icon className={compact ? "h-5 w-5" : "h-6 w-6"} />
      </span>
      <div className="space-y-1 max-w-md">
        <p className="font-semibold text-navy">{title}</p>
        {text && <p className="text-sm text-muted-foreground">{text}</p>}
      </div>
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
