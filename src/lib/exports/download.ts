// Browser-only helpers for handing an export to the user (fix 34). The heavy
// PDF and Excel libraries are loaded with import() on click, so they stay out
// of the main bundle.

import type { Cell, Row, SheetData } from "write-excel-file/universal";
import type { ExportCell, ExportTable } from "@/lib/exports/table";
import { toCsv } from "@/lib/exports/table";

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(table: ExportTable, fileName: string): void {
  // The BOM tells Excel the file is UTF-8, so names with accents survive.
  downloadBlob(new Blob(["﻿", toCsv(table)], { type: "text/csv;charset=utf-8" }), fileName);
}

const MONEY_FORMAT = "$#,##0.00";
const NAVY = "#0B213E";

/** One worksheet: title lines above the table (e.g. the report name and "Valued as of"). */
export interface XlsxSheet {
  name: string;
  title: string[];
  table: ExportTable;
}

function sheetData({ title, table }: XlsxSheet): SheetData {
  const data: Row[] = title.map((line, i) => [
    { value: line, type: String, ...(i === 0 ? { fontWeight: "bold" as const } : {}) },
  ]);
  if (title.length) data.push([]);
  data.push(
    table.columns.map(
      (col): Cell => ({
        value: col.label,
        type: String,
        fontWeight: "bold",
        textColor: "#FFFFFF",
        backgroundColor: NAVY,
        ...(col.kind === "money" ? { align: "right" as const } : {}),
      }),
    ),
  );
  const cells = (row: ExportCell[], bold: boolean): Row =>
    row.map((cell, i): Cell => {
      if (cell === null) return null;
      const weight = bold ? { fontWeight: "bold" as const } : {};
      // Money stays a real number so the sheet can sum it.
      if (typeof cell === "number" && table.columns[i]?.kind === "money") {
        return { value: cell, type: Number, format: MONEY_FORMAT, ...weight };
      }
      // Strings are written as text cells, never formulas, so there is no injection risk.
      return { value: String(cell), type: String, ...weight };
    });
  const emphasis = new Set(table.emphasis ?? []);
  table.rows.forEach((row, i) => data.push(cells(row, emphasis.has(i))));
  if (table.totals) data.push(cells(table.totals, true));
  return data;
}

export async function downloadXlsx(sheets: XlsxSheet[], fileName: string): Promise<void> {
  // The universal build makes a Blob without a Web Worker, which keeps the bundling simple.
  const { default: writeXlsxFile } = await import("write-excel-file/universal");
  const blob = await writeXlsxFile(
    sheets.map((sheet) => ({
      data: sheetData(sheet),
      // Excel sheet names are at most 31 characters and can't contain : \ / ? * [ ]
      sheet: sheet.name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31),
      columns: sheet.table.columns.map((col) => ({ width: col.kind === "text" ? 22 : 14 })),
    })),
  ).toBlob();
  downloadBlob(blob, fileName);
}

/** Saves a file the server built (fix 46: the executive report PDF). */
export function downloadBase64(base64: string, fileName: string, type = "application/pdf"): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  downloadBlob(new Blob([bytes], { type }), fileName);
}
