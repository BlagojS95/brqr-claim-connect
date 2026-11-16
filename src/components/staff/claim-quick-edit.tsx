// Quick edit slide-over for agency staff (fix 53). Opened from the staff work
// queue (fix 52) and from claim detail. PLACEHOLDER: fix 53 replaces the body;
// keep this export name and these props so callers don't change.

export interface ClaimQuickEditProps {
  claimId: string;
  /** Called after a successful save, e.g. to refetch the queue. */
  onSaved?: () => void;
  /** Button label; defaults to "Quick edit". */
  label?: string;
}

export function ClaimQuickEditButton({ label = "Quick edit" }: ClaimQuickEditProps) {
  return (
    <button type="button" disabled className="text-sm text-muted-foreground">
      {label}
    </button>
  );
}
