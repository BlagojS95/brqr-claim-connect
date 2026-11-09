import { useMemo, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import {
  activeFilterCount,
  claimFilterOptions,
  filterKey,
  type ClaimFilterKey,
  type ClaimListItem,
  type ClaimsSearch,
} from "@/lib/claims-list";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type ClaimFilters = Pick<ClaimsSearch, ClaimFilterKey>;

interface FilterField {
  key: ClaimFilterKey;
  label: string;
  allLabel: string;
  options: string[];
}

// The selects' choices, plus the URL's current value when no loaded claim has
// it (an old saved view, say), so the select still shows what is applied.
function withCurrent(options: string[], current: string | undefined): string[] {
  if (!current || options.some((o) => filterKey(o) === filterKey(current))) return options;
  return [current, ...options];
}

function selectedOption(options: string[], current: string | undefined): string {
  if (!current) return "";
  return options.find((o) => filterKey(o) === filterKey(current)) ?? current;
}

/**
 * Line, year, carrier and location filters on the claims list (fix 31). A row
 * of selects on desktop; on phones a "Filters" button opening a bottom sheet.
 * Options come from the claims the user can see.
 */
export function ClaimFiltersControl({
  claims,
  filters,
  onChange,
}: {
  claims: ClaimListItem[];
  filters: ClaimFilters;
  /** Called with the full new set of the four filters; undefined clears one. */
  onChange: (next: ClaimFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => claimFilterOptions(claims), [claims]);
  const count = activeFilterCount(filters);

  const fields: FilterField[] = [
    {
      key: "line",
      label: "Line of business",
      allLabel: "All lines",
      options: withCurrent(options.lines, filters.line),
    },
    {
      key: "year",
      label: "Year of loss",
      allLabel: "All years",
      options: withCurrent(
        options.years.map(String),
        filters.year === undefined ? undefined : String(filters.year),
      ),
    },
    {
      key: "carrier",
      label: "Carrier",
      allLabel: "All carriers",
      options: withCurrent(options.carriers, filters.carrier),
    },
    {
      key: "location",
      label: "Location",
      allLabel: "All locations",
      options: withCurrent(options.locations, filters.location),
    },
  ];

  const valueOf = (field: FilterField): string => {
    const current = filters[field.key];
    return selectedOption(field.options, current === undefined ? undefined : String(current));
  };

  const set = (key: ClaimFilterKey, value: string) => {
    const next: ClaimFilters = { ...filters };
    if (key === "year") next.year = value ? Number(value) : undefined;
    else next[key] = value || undefined;
    onChange(next);
  };

  const clear = () =>
    onChange({ line: undefined, year: undefined, carrier: undefined, location: undefined });

  const select = (field: FilterField, id: string, className?: string) => (
    <select
      id={id}
      value={valueOf(field)}
      onChange={(e) => set(field.key, e.target.value)}
      aria-label={field.label}
      className={cn(
        "rounded-md border border-input bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <option value="">{field.allLabel}</option>
      {field.options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <div className="hidden md:flex flex-wrap items-center gap-2">
        {fields.map((field) => (
          <div key={field.key}>
            {select(field, `claims-filter-${field.key}`, "h-9 text-sm max-w-52")}
          </div>
        ))}
        {count > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            <X className="h-4 w-4" aria-hidden />
            Clear filters
          </Button>
        )}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="md:hidden h-10 shrink-0"
            aria-label={count > 0 ? `Filters, ${count} active` : "Filters"}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Filters
            {count > 0 && (
              <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-navy px-1.5 text-xs font-semibold text-navy-foreground">
                {count}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="rounded-t-xl max-h-[85vh] overflow-y-auto pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="text-navy">Filters</SheetTitle>
            <SheetDescription>
              {count > 0
                ? `${count} active`
                : "Narrow the list by line, year, carrier or location."}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            {fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <label htmlFor={`claims-filter-sheet-${field.key}`} className="text-sm font-medium">
                  {field.label}
                </label>
                {select(field, `claims-filter-sheet-${field.key}`, "h-11 w-full text-base")}
              </div>
            ))}
          </div>
          <div className="mt-6 flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 h-11"
              onClick={clear}
              disabled={count === 0}
            >
              Clear filters
            </Button>
            <Button
              type="button"
              className="flex-1 h-11 bg-navy hover:bg-navy/90 text-navy-foreground"
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
