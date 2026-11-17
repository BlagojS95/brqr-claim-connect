import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Columns3, Eye, Rows3 } from "lucide-react";
import { toast } from "sonner";
import {
  MAX_BULK_CLAIMS,
  REQUIRED_CLAIMS_COLUMNS,
  TABLE_DENSITIES,
  TABLE_DENSITY_LABELS,
  type ClaimsTableColumn,
  type TableDensity,
} from "@/lib/claims-table";
import { watchClaimsBulk } from "@/lib/claim-watch-bulk.functions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Desktop only (phones show cards, which have no columns to choose). */
export function ColumnChooser({
  labels,
  columns,
  onToggle,
  onReset,
}: {
  labels: { key: ClaimsTableColumn; label: string }[];
  columns: readonly ClaimsTableColumn[];
  onToggle: (column: ClaimsTableColumn, visible: boolean) => void;
  onReset: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="hidden md:inline-flex">
          <Columns3 className="h-4 w-4" aria-hidden /> Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-3">
        <fieldset>
          <legend className="text-xs font-medium text-muted-foreground mb-2">Show columns</legend>
          <ul className="space-y-2">
            {labels.map(({ key, label }) => {
              const required = REQUIRED_CLAIMS_COLUMNS.includes(key);
              const id = `col-${key}`;
              return (
                <li key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={id}
                    checked={columns.includes(key)}
                    disabled={required}
                    onCheckedChange={(v) => onToggle(key, v === true)}
                  />
                  <label htmlFor={id}>{label}</label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={onReset}>
          Show all
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Comfortable / compact; applies to the table and to the phone cards. */
export function DensityMenu({
  density,
  onChange,
}: {
  density: TableDensity;
  onChange: (density: TableDensity) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Rows3 className="h-4 w-4" aria-hidden /> {TABLE_DENSITY_LABELS[density]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Row spacing
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={density} onValueChange={(v) => onChange(v as TableDensity)}>
          {TABLE_DENSITIES.map((d) => (
            <DropdownMenuRadioItem key={d} value={d}>
              {TABLE_DENSITY_LABELS[d]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shown while rows are ticked: the count, Watch and Clear (Export sits beside it). */
export function BulkWatchButton({ claimIds, onDone }: { claimIds: string[]; onDone: () => void }) {
  const watch = useServerFn(watchClaimsBulk);
  const mutation = useMutation({
    mutationFn: () => watch({ data: { claimIds } }),
    onSuccess: ({ watched }) => {
      toast.success(`Watching ${watched} ${watched === 1 ? "claim" : "claims"}.`);
      onDone();
    },
    onError: (err) =>
      toast.error(
        err instanceof Error && err.message ? err.message : "Could not watch the claims.",
      ),
  });
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={mutation.isPending || claimIds.length === 0 || claimIds.length > MAX_BULK_CLAIMS}
      onClick={() => mutation.mutate()}
    >
      <Eye className="h-4 w-4" aria-hidden /> {mutation.isPending ? "Watching…" : "Watch"}
    </Button>
  );
}
