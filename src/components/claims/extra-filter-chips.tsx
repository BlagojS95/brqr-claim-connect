import { X } from "lucide-react";
import { formatDate } from "@/lib/dates";
import type { ClaimExtraFilterKey, ClaimsSearch } from "@/lib/claims-list";

/**
 * The filters an Insights chart click adds (fix 45): loss-date range, cause
 * and policy. They have no select of their own, so each shows as a chip that
 * removes it.
 */
export function ExtraFilterChips({
  search,
  onRemove,
}: {
  search: Pick<ClaimsSearch, ClaimExtraFilterKey>;
  onRemove: (keys: ClaimExtraFilterKey[]) => void;
}) {
  const chips: { label: string; keys: ClaimExtraFilterKey[] }[] = [];
  if (search.from || search.to) {
    const range =
      search.from && search.to
        ? `${formatDate(search.from)} – ${formatDate(search.to)}`
        : search.from
          ? `from ${formatDate(search.from)}`
          : `to ${formatDate(search.to)}`;
    chips.push({ label: `Loss date ${range}`, keys: ["from", "to"] });
  }
  if (search.cause) chips.push({ label: `Cause: ${search.cause}`, keys: ["cause"] });
  if (search.policy) chips.push({ label: `Policy: ${search.policy}`, keys: ["policy"] });
  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="More filters">
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={() => onRemove(chip.keys)}
          className="inline-flex items-center gap-1 rounded-full border border-navy/30 bg-navy/5 px-3 py-1 text-xs text-navy hover:bg-navy/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Remove filter ${chip.label}`}
        >
          {chip.label}
          <X className="h-3 w-3" aria-hidden />
        </button>
      ))}
    </div>
  );
}
