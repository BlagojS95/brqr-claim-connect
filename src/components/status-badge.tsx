import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Open: "bg-success/15 text-success border-success/30",
    Closed: "bg-muted text-muted-foreground border-border",
    Pending: "bg-warning/20 text-warning-foreground border-warning/40",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
        map[status] ?? "bg-muted text-muted-foreground border-border"
      )}
    >
      {status}
    </span>
  );
}
