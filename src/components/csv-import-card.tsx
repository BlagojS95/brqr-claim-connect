import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import Papa from "papaparse";
import { importRows, type ImportResult } from "@/lib/import.functions";
import {
  IMPORT_KINDS,
  mapHeaders,
  mapRows,
  rollUpPolicies,
  sheetToRecords,
  type HeaderMapping,
  type ImportKind,
  type SheetRecords,
} from "@/lib/import-mapping";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Upload } from "lucide-react";

const CHUNK_SIZE = 1000;

interface ParsedFile {
  name: string;
  /** one entry per worksheet; a CSV is a single sheet */
  sheets: SheetRecords[];
}

function parseCsv(file: File): Promise<SheetRecords[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (result) => resolve([{ headers: result.meta.fields ?? [], rows: result.data }]),
      error: (err) => reject(err),
    });
  });
}

async function parseExcel(file: File): Promise<SheetRecords[]> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  return sheets.map((s) => sheetToRecords(s.data));
}

export function CsvImportCard() {
  const qc = useQueryClient();
  const sendRows = useServerFn(importRows);
  const [kind, setKind] = useState<ImportKind>("policies");
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  // An Excel export can carry extra sheets (pivot tables etc.); use the first
  // one that has the columns this kind of import needs.
  const picked = (() => {
    if (!file) return null;
    const candidates = file.sheets.map((sheet) => ({ sheet, mapping: mapHeaders(kind, sheet.headers) }));
    return candidates.find((c) => c.mapping.missing.length === 0) ?? candidates[0] ?? null;
  })();
  const mapping: HeaderMapping | null = picked?.mapping ?? null;

  const prepared = (() => {
    if (!picked) return [];
    const rows = mapRows(picked.sheet.rows, picked.mapping);
    return kind === "policies" ? rollUpPolicies(rows) : rows;
  })();

  const reset = () => {
    setCheck(null);
    setDone(null);
  };

  const onFile = async (chosen: File | undefined) => {
    reset();
    if (!chosen) {
      setFile(null);
      return;
    }
    try {
      const isExcel = /\.xlsx$/i.test(chosen.name);
      setFile({ name: chosen.name, sheets: await (isExcel ? parseExcel(chosen) : parseCsv(chosen)) });
    } catch (e) {
      setFile(null);
      toast.error(`Could not read file: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  };

  // The file goes up in chunks so one request never carries the whole thing.
  const run = async (dryRun: boolean): Promise<ImportResult> => {
    const total: ImportResult = { inserted: 0, updated: 0, unchanged: 0, skipped: [], newClients: [] };
    const newClients = new Set<string>();
    for (let start = 0; start < prepared.length; start += CHUNK_SIZE) {
      const part = await sendRows({ data: { kind, rows: prepared.slice(start, start + CHUNK_SIZE), dryRun } });
      total.inserted += part.inserted;
      total.updated += part.updated;
      total.unchanged += part.unchanged;
      total.skipped.push(...part.skipped);
      part.newClients.forEach((name) => newClients.add(name));
    }
    return { ...total, newClients: [...newClients] };
  };

  const onCheck = async () => {
    setBusy(true);
    try {
      setCheck(await run(true));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check failed");
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
    setBusy(true);
    try {
      const result = await run(false);
      setDone(result);
      setCheck(null);
      toast.success(`Imported: ${result.inserted} new, ${result.updated} updated`);
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const usable = !!mapping && mapping.missing.length === 0 && prepared.length > 0;
  const sourceRows = picked?.sheet.rows.length ?? 0;

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="p-5 border-b border-border">
        <h2 className="font-semibold text-navy">Import data</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Upload an Excel or CSV export. A Book of Business report adds its clients and policies in one go. Uploading
          the same report again updates what changed instead of duplicating it.
        </p>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={kind}
            onValueChange={(v) => {
              setKind(v as ImportKind);
              reset();
            }}
          >
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {IMPORT_KINDS.map((k) => <SelectItem key={k.kind} value={k.kind}>{k.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <label className="inline-flex items-center gap-2 border border-dashed border-border rounded-md px-4 py-2 cursor-pointer hover:bg-muted/30 text-sm text-muted-foreground">
            <Upload className="h-4 w-4" />
            {file ? file.name : "Choose Excel or CSV file"}
            <input
              type="file"
              accept=".xlsx,.csv,text/csv"
              className="hidden"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>

          <Button variant="outline" disabled={!usable || busy} onClick={onCheck}>
            {busy && !check ? "Working…" : "Check file"}
          </Button>
          <Button
            className="bg-navy hover:bg-navy/90 text-navy-foreground"
            disabled={!usable || !check || busy}
            onClick={onImport}
          >
            Import
          </Button>
        </div>

        {file && mapping && (
          <div className="text-sm space-y-2">
            {mapping.missing.length > 0 ? (
              <p className="text-destructive">
                This file can't be imported as {kind}: no column found for {mapping.missing.join(", and ")}.
              </p>
            ) : (
              <p className="text-muted-foreground">
                {sourceRows} rows in the file
                {prepared.length !== sourceRows && `, combined into ${prepared.length} ${kind}`}.
              </p>
            )}
            <div>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Columns used</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {Object.entries(mapping.fields).map(([field, header]) => (
                  <span key={field} className="text-xs rounded border border-border px-2 py-0.5">
                    {header} → <span className="font-mono">{field}</span>
                  </span>
                ))}
                {Object.keys(mapping.fields).length === 0 && <span className="text-muted-foreground">None</span>}
              </div>
            </div>
            {mapping.ignored.length > 0 && (
              <p className="text-xs text-muted-foreground">Not imported: {mapping.ignored.join(", ")}</p>
            )}
          </div>
        )}

        {check && <ResultSummary title="If you import this file" result={check} />}
        {done && <ResultSummary title="Import finished" result={done} />}
      </div>
    </section>
  );
}

function ResultSummary({ title, result }: { title: string; result: ImportResult }) {
  return (
    <div className="rounded-md border border-border p-4 text-sm space-y-2">
      <div className="font-medium text-navy">{title}</div>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span>New: <b>{result.inserted}</b></span>
        <span>Updated: <b>{result.updated}</b></span>
        <span>Unchanged: <b>{result.unchanged}</b></span>
        <span>Skipped: <b>{result.skipped.length}</b></span>
      </div>
      {result.newClients.length > 0 && (
        <p className="text-xs">
          <span className="font-medium">New clients ({result.newClients.length}):</span>{" "}
          <span className="text-muted-foreground">{result.newClients.join(", ")}</span>
        </p>
      )}
      {result.skipped.length > 0 && (
        <ul className="text-xs text-muted-foreground max-h-40 overflow-y-auto space-y-0.5">
          {result.skipped.slice(0, 200).map((s, i) => (
            <li key={i}>Row {s.row}: {s.reason}</li>
          ))}
          {result.skipped.length > 200 && <li>…and {result.skipped.length - 200} more</li>}
        </ul>
      )}
    </div>
  );
}
