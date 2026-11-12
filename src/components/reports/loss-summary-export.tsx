import { useState } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/dates";
import { downloadXlsx } from "@/lib/exports/download";
import { exportFileName } from "@/lib/exports/table";
import { lossSummaryExportTable, type LossSummary } from "@/lib/loss-summary";
import { Button } from "@/components/ui/button";

const TITLE = "Loss Summary";

export interface LossSummaryExportInfo {
  /** "YYYY-MM-DD": today on Reports, the link's day on a shared report. */
  valuedAsOf: string;
  /** The client, when the report is one client's. */
  client?: string;
  /** What the report was filtered to, e.g. "Year 2026 · Business Auto". */
  filters: string;
}

/**
 * PDF and Excel downloads of the Loss Summary as shown (fix 44): the same
 * rows, subtotals and grand total, every page and the top of the sheet
 * stamped "Valued as of <date>".
 */
export function LossSummaryExport({
  summary,
  info,
}: {
  summary: LossSummary;
  info: LossSummaryExportInfo;
}) {
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);

  const run = async (format: "pdf" | "xlsx") => {
    const valuedAs = `Valued as of ${formatDate(info.valuedAsOf)}`;
    const fileName = exportFileName("loss-summary", info.valuedAsOf, format);
    setBusy(format);
    try {
      if (format === "pdf") {
        await downloadLossSummaryPdf(summary, { ...info, valuedAs, fileName });
      } else {
        const title = [
          `ClaimsQR ${TITLE}`,
          valuedAs,
          ...(info.client ? [info.client] : []),
          info.filters,
        ];
        await downloadXlsx(
          [{ name: TITLE, title, table: lossSummaryExportTable(summary) }],
          fileName,
        );
      }
    } catch (err) {
      console.error("loss summary export failed", err);
      toast.error("The report could not be created. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const disabled = busy !== null || summary.totals.claims === 0;
  return (
    <>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => void run("pdf")}>
        <FileText className="h-4 w-4" aria-hidden />
        {busy === "pdf" ? "Creating…" : "PDF"}
      </Button>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => void run("xlsx")}>
        <FileSpreadsheet className="h-4 w-4" aria-hidden />
        {busy === "xlsx" ? "Creating…" : "Excel"}
      </Button>
    </>
  );
}

async function downloadLossSummaryPdf(
  summary: LossSummary,
  info: LossSummaryExportInfo & { valuedAs: string; fileName: string },
) {
  const { createPdfReport, pdfMoney, PDF_LIGHT, PDF_MARGIN, PDF_MUTED, PDF_NAVY, PDF_TOP } =
    await import("@/lib/exports/pdf");
  const report = await createPdfReport({
    title: TITLE,
    valuedAs: info.valuedAs,
    subtitle: info.client,
    orientation: "landscape",
  });
  const { doc } = report;
  const table = lossSummaryExportTable(summary);
  const emphasis = new Set(table.emphasis);
  const cell = (value: string | number | null, i: number) =>
    value === null
      ? ""
      : table.columns[i].kind === "money"
        ? pdfMoney(Number(value))
        : String(value);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_MUTED);
  doc.text(info.filters, PDF_MARGIN, PDF_TOP + 4);

  report.autoTable({
    startY: PDF_TOP + 12,
    head: [table.columns.map((c) => c.label)],
    body: table.rows.map((row) => row.map(cell)),
    foot: table.totals ? [table.totals.map(cell)] : undefined,
    showFoot: "lastPage",
    columnStyles: Object.fromEntries(
      table.columns.flatMap((c, i) =>
        c.kind === "money" ? [[i, { halign: "right" as const }]] : [],
      ),
    ),
    didParseCell: (data) => {
      // Subtotal rows stand out like they do on the page.
      if (data.section === "body" && emphasis.has(data.row.index)) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = PDF_LIGHT;
        data.cell.styles.textColor = PDF_NAVY;
      }
    },
  });

  report.save(info.fileName);
}
