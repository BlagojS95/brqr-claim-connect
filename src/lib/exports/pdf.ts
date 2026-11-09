// Branded PDF reports (fixes 34 and 36). jsPDF and jspdf-autotable are only
// imported when a user asks for a PDF, so they never load with the app.
// Every page gets the ClaimsQR header and a footer with "Valued as of" and the
// page number, drawn after the content so the page count is known.

import type { jsPDF } from "jspdf";
import type { UserOptions } from "jspdf-autotable";
import { downloadBlob } from "@/lib/exports/download";

type Rgb = [number, number, number];

// The navy and gold of the app's palette (src/styles.css, --navy and --gold).
export const PDF_NAVY: Rgb = [11, 33, 62];
export const PDF_GOLD: Rgb = [205, 166, 80];
export const PDF_MUTED: Rgb = [100, 110, 125];
export const PDF_LIGHT: Rgb = [243, 245, 248];

export const PDF_MARGIN = 40;
/** Content starts below the header band. */
export const PDF_TOP = 78;
const PDF_BOTTOM = 44;

export interface PdfReport {
  doc: jsPDF;
  autoTable: (options: UserOptions) => void;
  /** Where the last table ended, to place what comes next. */
  lastY: () => number;
  pageWidth: number;
  pageHeight: number;
  /** Starts a new page when fewer than `needed` points are left. */
  ensureSpace: (y: number, needed: number) => number;
}

export interface PdfReportOptions {
  title: string;
  /** e.g. "Valued as of 11/9/2026"; printed on every page. */
  valuedAs: string;
  /** A second header line, e.g. the client name. */
  subtitle?: string;
  orientation?: "portrait" | "landscape";
}

export async function createPdfReport(
  options: PdfReportOptions,
): Promise<PdfReport & { save: (fileName: string) => void }> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({
    orientation: options.orientation ?? "portrait",
    unit: "pt",
    format: "letter",
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let finalY = PDF_TOP;

  const report: PdfReport = {
    doc,
    pageWidth,
    pageHeight,
    autoTable: (tableOptions) => {
      const { styles, didParseCell, ...rest } = tableOptions;
      autoTable(doc, {
        margin: { top: PDF_TOP, bottom: PDF_BOTTOM + 8, left: PDF_MARGIN, right: PDF_MARGIN },
        headStyles: { fillColor: PDF_NAVY, textColor: [255, 255, 255], fontStyle: "bold" },
        footStyles: { fillColor: PDF_LIGHT, textColor: PDF_NAVY, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [250, 251, 252] },
        ...rest,
        styles: { fontSize: 8, cellPadding: 4, textColor: [30, 30, 30], ...styles },
        didParseCell: (data) => {
          // Header and totals line up with their column (money to the right).
          const halign = tableOptions.columnStyles?.[data.column.index]?.halign;
          if (halign && data.section !== "body") data.cell.styles.halign = halign;
          didParseCell?.(data);
        },
      });
      const last = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
      finalY = last?.finalY ?? finalY;
    },
    lastY: () => finalY,
    ensureSpace: (y, needed) => {
      if (y + needed <= pageHeight - PDF_BOTTOM - 8) return y;
      doc.addPage();
      return PDF_TOP;
    },
  };

  const save = (fileName: string) => {
    drawFrame(doc, options, pageWidth, pageHeight);
    downloadBlob(doc.output("blob"), fileName);
  };
  return { ...report, save };
}

function drawFrame(doc: jsPDF, options: PdfReportOptions, pageWidth: number, pageHeight: number) {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    // Header band: ClaimsQR in gold on navy, the report title, "Valued as of".
    doc.setFillColor(...PDF_NAVY);
    doc.rect(0, 0, pageWidth, 54, "F");
    doc.setFillColor(...PDF_GOLD);
    doc.rect(0, 54, pageWidth, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...PDF_GOLD);
    doc.text("ClaimsQR", PDF_MARGIN, 26);
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(options.title, PDF_MARGIN, 43);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(options.valuedAs, pageWidth - PDF_MARGIN, 26, { align: "right" });
    if (options.subtitle) {
      doc.text(options.subtitle, pageWidth - PDF_MARGIN, 43, { align: "right" });
    }

    // Footer: "Valued as of" again, the agency and the page number.
    doc.setDrawColor(220, 224, 230);
    doc.line(
      PDF_MARGIN,
      pageHeight - PDF_BOTTOM + 8,
      pageWidth - PDF_MARGIN,
      pageHeight - PDF_BOTTOM + 8,
    );
    doc.setFontSize(8);
    doc.setTextColor(...PDF_MUTED);
    const y = pageHeight - PDF_BOTTOM + 22;
    doc.text(`${options.valuedAs} · BRQR Insurance Agency · claimsqr.com`, PDF_MARGIN, y);
    doc.text(`Page ${page} of ${pages}`, pageWidth - PDF_MARGIN, y, { align: "right" });
  }
}

export const pdfMoney = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
