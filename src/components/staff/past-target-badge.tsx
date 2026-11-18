/** Red "Past target" flag for a claim past a response target (fix 56). */
export function PastTargetBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[0.75rem] font-medium text-destructive whitespace-nowrap">
      Past target
    </span>
  );
}
