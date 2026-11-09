import { useState } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { formatDate, todayIso } from "@/lib/dates";
import { downloadXlsx } from "@/lib/exports/download";
import {
  lossRunDetailTable,
  lossRunGroupTable,
  lossSummaryTable,
  yearLabel,
  type LossSummaryGroup,
} from "@/lib/exports/loss-summary-export";
import type { ExportTable } from "@/lib/exports/table";
import { exportFileName } from "@/lib/exports/table";
import type { AgencyClaim } from "@/lib/overview.types";
import { Button } from "@/components/ui/button";

const TITLE = "Loss Summary";

/** The client's name when every claim is theirs (a client's own report). */
function singleClientName(groups: LossSummaryGroup<AgencyClaim>[]): string | undefined {
  const names = new Set(groups.flatMap((g) => g.rows.map((c) => c.client_name)));
  return names.size === 1 ? [...names][0] || undefined : undefined;
}

/**
 * PDF and Excel downloads of the Loss Summary (fix 34), built from the groups
 * on screen, so a search narrows the export the same way. Every PDF page and
 * the top of each sheet say what date the figures are valued as of.
 */
export function LossSummaryExport({ groups }: { groups: LossSummaryGroup<AgencyClaim>[] }) {
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);

  const run = async (format: "pdf" | "xlsx") => {
    const today = todayIso();
    const valuedAs = `Valued as of ${formatDate(today)}`;
    const client = singleClientName(groups);
    setBusy(format);
    try {
      if (format === "pdf") {
        await downloadLossSummaryPdf(groups, { valuedAs, client, today });
      } else {
        const title = ["ClaimsQR " + TITLE, valuedAs, ...(client ? [client] : [])];
        await downloadXlsx(
          [
            { name: "Summary", title, table: lossSummaryTable(groups) },
            { name: "Claims", title, table: lossRunDetailTable(groups) },
          ],
          exportFileName("loss-summary", today, "xlsx"),
        );
      }
    } catch (err) {
      console.error("loss summary export failed", err);
      toast.error("The report could not be created. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const disabled = busy !== null || groups.length === 0;
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => void run("pdf")}>
        <FileText className="h-4 w-4" aria-hidden />
        {busy === "pdf" ? "Creating…" : "PDF"}
      </Button>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => void run("xlsx")}>
        <FileSpreadsheet className="h-4 w-4" aria-hidden />
        {busy === "xlsx" ? "Creating…" : "Excel"}
      </Button>
    </div>
  );
}

async function downloadLossSummaryPdf(
  groups: LossSummaryGroup[],
  { valuedAs, client, today }: { valuedAs: string; client?: string; today: string },
) {
  const { createPdfReport, pdfMoney, PDF_NAVY, PDF_MARGIN, PDF_TOP } =
    await import("@/lib/exports/pdf");
  const report = await createPdfReport({ title: TITLE, valuedAs, subtitle: client });
  const { doc } = report;

  const body = (table: ExportTable, rows: ExportTable["rows"]) =>
    rows.map((row) =>
      row.map((cell, i) =>
        cell === null
          ? ""
          : table.columns[i].kind === "money"
            ? pdfMoney(Number(cell))
            : String(cell),
      ),
    );
  const moneyColumns = (table: ExportTable) =>
    Object.fromEntries(
      table.columns.flatMap((col, i) =>
        col.kind === "money" ? [[i, { halign: "right" as const }]] : [],
      ),
    );
  const drawTable = (table: ExportTable, startY: number) =>
    report.autoTable({
      startY,
      head: [table.columns.map((c) => c.label)],
      body: body(table, table.rows),
      foot: table.totals ? body(table, [table.totals]) : undefined,
      showFoot: "lastPage",
      columnStyles: moneyColumns(table),
    });

  const heading = (text: string, y: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...PDF_NAVY);
    doc.text(text, PDF_MARGIN, y);
  };

  heading("Summary by year, line of business and carrier", PDF_TOP + 6);
  drawTable(lossSummaryTable(groups), PDF_TOP + 14);

  for (const group of groups) {
    const y = report.ensureSpace(report.lastY() + 28, 70);
    heading(`${group.lob} · ${yearLabel(group.year)} · ${group.carrier}`, y);
    drawTable(lossRunGroupTable(group), y + 8);
  }

  report.save(exportFileName("loss-summary", today, "pdf"));
}
