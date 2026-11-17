import { useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import type { ClaimsSearch } from "@/lib/claims-list";
import { selectedClaims } from "@/lib/claims-table";
import { todayIso, formatDate } from "@/lib/dates";
import { buildClaimsExport, claimsToExport } from "@/lib/exports/claims-export";
import { downloadCsv, downloadXlsx } from "@/lib/exports/download";
import { exportFileName } from "@/lib/exports/table";
import type { AgencyClaim } from "@/lib/overview.types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * "Export" on the claims list (fix 34): downloads every claim matching the
 * current filters, in the current sort order, not just the page on screen.
 */
export function ExportMenu({
  claims,
  search,
  selected,
}: {
  claims: AgencyClaim[];
  search: ClaimsSearch;
  /** Fix 50: when rows are ticked, export just these (in the list's order). */
  selected?: ReadonlySet<string>;
}) {
  const { role } = useAuth();
  const [busy, setBusy] = useState(false);
  const matching = claimsToExport(claims, search);
  const hasSelection = !!selected && selected.size > 0;
  const rows = hasSelection ? selectedClaims(matching, selected) : matching;

  const run = async (format: "csv" | "xlsx") => {
    const today = todayIso();
    const table = buildClaimsExport(rows, { includeClient: role === "agency_admin" });
    setBusy(true);
    try {
      if (format === "csv") {
        downloadCsv(table, exportFileName("claims", today, "csv"));
      } else {
        await downloadXlsx(
          [
            {
              name: "Claims",
              title: ["ClaimsQR claims export", `Valued as of ${formatDate(today)}`],
              table,
            },
          ],
          exportFileName("claims", today, "xlsx"),
        );
      }
    } catch (err) {
      console.error("claims export failed", err);
      toast.error("The export could not be created. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy || rows.length === 0}>
          <Download className="h-4 w-4" aria-hidden />
          {busy ? "Exporting…" : hasSelection ? "Export selected" : "Export"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {rows.length} {rows.length === 1 ? "claim" : "claims"}{" "}
          {hasSelection ? "selected" : "matching your filters"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void run("csv")}>
          <FileText className="h-4 w-4" aria-hidden /> CSV (.csv)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run("xlsx")}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel (.xlsx)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
