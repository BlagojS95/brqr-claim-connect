// Reads an uploaded CSV or Excel file in the browser into header-keyed string
// records. Shared by the client/policy/claims import (csv-import-card.tsx) and
// the carrier import (/admin/import).
import Papa from "papaparse";
import { sheetToRecords, type SheetRecords } from "@/lib/import-mapping";

export function parseCsv(file: File): Promise<SheetRecords[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (result) => resolve([{ headers: result.meta.fields ?? [], rows: result.data }]),
      error: (err) => reject(err),
    });
  });
}

export async function parseExcel(file: File): Promise<SheetRecords[]> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  return sheets.map((s) => sheetToRecords(s.data));
}
