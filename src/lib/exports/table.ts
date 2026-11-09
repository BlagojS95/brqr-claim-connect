// A plain table that every export format (CSV, Excel, PDF) is written from, so
// the three always carry the same rows and totals (fix 34).

export type ExportColumnKind = "text" | "money" | "date";

export interface ExportColumn {
  label: string;
  kind: ExportColumnKind;
}

/** Text, a number (money), or nothing. Dates are already formatted text. */
export type ExportCell = string | number | null;

export interface ExportTable {
  columns: ExportColumn[];
  rows: ExportCell[][];
  /** The totals row, same width as the columns, or null when there is none. */
  totals: ExportCell[] | null;
}

// Cells starting with one of these are run as a formula by Excel, Sheets and
// LibreOffice, so a claim description of "=HYPERLINK(...)" could do harm.
const FORMULA_START = /^[=+\-@\t\r]/;

/** Neutralises spreadsheet formula injection by prefixing an apostrophe. */
export function guardFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

function csvField(cell: ExportCell): string {
  if (cell === null) return "";
  // Numbers come from our own money columns, so they are never a formula; a
  // negative amount stays a number in the spreadsheet.
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  const text = guardFormula(cell);
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV: comma separated, CRLF line ends, fields quoted when needed. */
export function toCsv(table: ExportTable): string {
  const lines = [table.columns.map((c) => c.label), ...table.rows];
  if (table.totals) lines.push(table.totals);
  return lines.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** "claims-2026-11-09.csv" style names; `today` is "YYYY-MM-DD". */
export function exportFileName(base: string, today: string, extension: string): string {
  return `${base}-${today}.${extension}`;
}
