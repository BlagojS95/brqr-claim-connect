// /admin/import (fix 53): update claims from a carrier's claim report.
// Pick the carrier, upload its CSV (or Excel) file, map the columns once per
// carrier (saved), preview what would change, then apply. Unmatched rows are
// listed for staff to handle by hand. All writes go through server functions
// that check the agency_admin role.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Upload } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { parseCsv, parseExcel } from "@/lib/read-spreadsheet";
import {
  applyCarrierImport,
  fetchCarrierClaims,
  fetchCarrierImportSetup,
  saveCarrierImportMapping,
  type CarrierImportApplyResult,
} from "@/lib/carrier-import.functions";
import {
  CARRIER_IMPORT_CHUNK,
  CARRIER_IMPORT_FIELDS,
  CARRIER_IMPORT_FIELD_LABELS,
  MAX_CARRIER_IMPORT_ROWS,
  applyCarrierMapping,
  buildCarrierImportPreview,
  guessCarrierMapping,
  usableMapping,
  type CarrierImportField,
  type CarrierImportPreview,
  type CarrierMapping,
  type MatchedRow,
} from "@/lib/carrier-import";
import { describeChange } from "@/lib/claim-quick-edit";
import type { SheetRecords } from "@/lib/import-mapping";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_app/admin_/import")({
  head: () => ({ meta: [{ title: "Carrier import | ClaimsQR" }] }),
  component: CarrierImportPage,
});

const SETUP_KEY = ["carrier-import-setup"] as const;

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-base md:h-9 md:text-sm";

function CarrierImportPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const getSetup = useServerFn(fetchCarrierImportSetup);
  const getClaims = useServerFn(fetchCarrierClaims);
  const saveMapping = useServerFn(saveCarrierImportMapping);
  const apply = useServerFn(applyCarrierImport);

  const setup = useQuery({
    queryKey: SETUP_KEY,
    queryFn: () => getSetup(),
    enabled: role === "agency_admin",
  });

  const [carrier, setCarrier] = useState("");
  const [file, setFile] = useState<{ name: string; sheet: SheetRecords } | null>(null);
  const [mapping, setMapping] = useState<CarrierMapping>({});
  const [preview, setPreview] = useState<CarrierImportPreview | null>(null);
  const [result, setResult] = useState<CarrierImportApplyResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

  const carrierName = carrier.trim();
  const known = setup.data?.carriers.find(
    (c) => c.name.toLowerCase() === carrierName.toLowerCase(),
  );
  const savedMapping = setup.data?.mappings.find(
    (m) => m.carrier.toLowerCase() === carrierName.toLowerCase(),
  )?.mapping;

  // A new file or carrier starts from the carrier's saved mapping, else a guess.
  const startMapping = (headers: string[], saved: CarrierMapping | undefined) => {
    const fromSaved = saved ? usableMapping(saved, headers) : {};
    setMapping(
      fromSaved.claim_number ? fromSaved : { ...guessCarrierMapping(headers), ...fromSaved },
    );
  };

  const clearResults = () => {
    setPreview(null);
    setResult(null);
  };

  const onCarrier = (value: string) => {
    setCarrier(value);
    clearResults();
    const saved = setup.data?.mappings.find(
      (m) => m.carrier.toLowerCase() === value.trim().toLowerCase(),
    )?.mapping;
    if (file && saved) startMapping(file.sheet.headers, saved);
  };

  const onFile = async (chosen: File | undefined) => {
    clearResults();
    setFile(null);
    if (!chosen) return;
    try {
      const sheets = /\.xlsx$/i.test(chosen.name)
        ? await parseExcel(chosen)
        : await parseCsv(chosen);
      const sheet = sheets[0];
      if (!sheet || sheet.rows.length === 0) throw new Error("the file has no rows");
      if (sheet.rows.length > MAX_CARRIER_IMPORT_ROWS) {
        throw new Error(
          `it has ${sheet.rows.length.toLocaleString()} rows; the limit is ${MAX_CARRIER_IMPORT_ROWS.toLocaleString()}. Split it into smaller files.`,
        );
      }
      setFile({ name: chosen.name, sheet });
      startMapping(sheet.headers, savedMapping);
    } catch (e) {
      toast.error(`Couldn't read the file: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  };

  const rows = useMemo(
    () => (file ? applyCarrierMapping(file.sheet.rows, mapping) : []),
    [file, mapping],
  );

  const onPreview = async () => {
    if (!mapping.claim_number) return;
    setBusy("preview");
    setResult(null);
    try {
      const { claim_number, ...rest } = mapping;
      const [claims] = await Promise.all([
        getClaims({ data: { carrier: carrierName } }),
        saveMapping({ data: { carrier: carrierName, mapping: { claim_number, ...rest } } }),
      ]);
      setPreview(buildCarrierImportPreview(rows, claims));
      qc.invalidateQueries({ queryKey: SETUP_KEY });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(null);
    }
  };

  const onApply = async () => {
    if (!preview) return;
    setBusy("apply");
    // Only the first row for each matched claim that changes something; the
    // server matches again and works out the changes itself.
    const wanted = new Set(preview.changed.map((m) => m.row));
    const toSend = rows.filter((r) => wanted.has(r.row));
    const total: CarrierImportApplyResult = { updated: 0, unchanged: 0, unmatched: 0, failed: [] };
    try {
      for (let start = 0; start < toSend.length; start += CARRIER_IMPORT_CHUNK) {
        const part = await apply({
          data: { carrier: carrierName, rows: toSend.slice(start, start + CARRIER_IMPORT_CHUNK) },
        });
        total.updated += part.updated;
        total.unchanged += part.unchanged;
        total.unmatched += part.unmatched;
        total.failed.push(...part.failed);
      }
      toast.success(`Updated ${total.updated} claim${total.updated === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setResult(total);
      setPreview(null);
      setBusy(null);
      qc.invalidateQueries();
    }
  };

  if (role !== "agency_admin") {
    return <div className="text-muted-foreground">Admin access required.</div>;
  }

  const canPreview = !!carrierName && !!file && !!mapping.claim_number && !busy;

  return (
    <div className="space-y-6">
      <Link
        to="/admin"
        className="inline-flex items-center gap-1 text-sm text-navy hover:text-gold-text"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to admin
      </Link>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-navy">Carrier import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Update claims from a carrier's claim report. Rows are matched to that carrier's claims by
          carrier claim number; blank cells never clear what is stored.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ci-carrier">1. Carrier</Label>
            <Input
              id="ci-carrier"
              list="ci-carriers"
              placeholder="Choose or type a carrier"
              value={carrier}
              onChange={(e) => onCarrier(e.target.value)}
              autoComplete="off"
            />
            <datalist id="ci-carriers">
              {setup.data?.carriers.map((c) => (
                <option key={c.name} value={c.name} />
              ))}
            </datalist>
            {carrierName && (
              <p className="text-xs text-muted-foreground">
                {known
                  ? `${known.claims} claim${known.claims === 1 ? "" : "s"} with this carrier`
                  : "No claims with this carrier yet, so nothing will match"}
                {savedMapping ? " · saved column mapping" : ""}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium leading-none">2. Carrier file</span>
            <label className="flex items-center gap-2 border border-dashed border-border rounded-md px-4 py-2 cursor-pointer hover:bg-muted/30 text-sm text-muted-foreground min-w-0">
              <Upload className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{file ? file.name : "Choose CSV or Excel file"}</span>
              <input
                type="file"
                accept=".csv,.xlsx,text/csv"
                className="hidden"
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.sheet.rows.length.toLocaleString()} rows · up to{" "}
                {MAX_CARRIER_IMPORT_ROWS.toLocaleString()} per file
              </p>
            )}
          </div>
        </div>

        {file && (
          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-medium">3. Columns</h2>
              <p className="text-xs text-muted-foreground">
                Saved for {carrierName || "this carrier"} when you preview, so the next file maps
                itself.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {CARRIER_IMPORT_FIELDS.map((field) => (
                <MappingSelect
                  key={field}
                  field={field}
                  headers={file.sheet.headers}
                  value={mapping[field]}
                  onChange={(column) => {
                    clearResults();
                    setMapping((m) => {
                      const next = { ...m };
                      if (column) next[field] = column;
                      else delete next[field];
                      return next;
                    });
                  }}
                />
              ))}
            </div>
            {!mapping.claim_number && (
              <p className="text-sm text-destructive">
                Choose the column that holds the carrier claim number.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" disabled={!canPreview} onClick={onPreview}>
            {busy === "preview" ? "Checking…" : "4. Preview changes"}
          </Button>
          <Button
            className="bg-navy hover:bg-navy/90 text-navy-foreground"
            disabled={!preview || preview.changed.length === 0 || !!busy}
            onClick={onApply}
          >
            {busy === "apply"
              ? "Updating…"
              : `5. Apply${preview ? ` to ${preview.changed.length} claim${preview.changed.length === 1 ? "" : "s"}` : ""}`}
          </Button>
        </div>
      </section>

      {result && <ApplyResult result={result} />}
      {preview && <PreviewView preview={preview} />}
    </div>
  );
}

function MappingSelect({
  field,
  headers,
  value,
  onChange,
}: {
  field: CarrierImportField;
  headers: string[];
  value: string | undefined;
  onChange: (column: string | undefined) => void;
}) {
  const id = `ci-map-${field}`;
  return (
    <div className="space-y-1.5 min-w-0">
      <Label htmlFor={id}>
        {CARRIER_IMPORT_FIELD_LABELS[field]}
        {field === "claim_number" && <span className="text-destructive"> *</span>}
      </Label>
      <select
        id={id}
        className={selectClass}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">
          {field === "claim_number" ? "Choose a column…" : "Not in this file"}
        </option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </div>
  );
}

function PreviewView({ preview }: { preview: CarrierImportPreview }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          Will update: <b>{preview.changed.length}</b>
        </span>
        <span>
          Already up to date: <b>{preview.unchanged.length}</b>
        </span>
        <span>
          Unmatched: <b>{preview.unmatched.length}</b>
        </span>
      </div>

      {preview.changed.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <h2 className="p-4 border-b border-border font-semibold text-navy">Changes</h2>
          <ul className="divide-y divide-border">
            {preview.changed.slice(0, 500).map((m) => (
              <MatchedItem key={m.row} match={m} />
            ))}
          </ul>
          {preview.changed.length > 500 && (
            <p className="p-4 text-xs text-muted-foreground">
              …and {preview.changed.length - 500} more
            </p>
          )}
        </div>
      )}

      {preview.unchanged.some((m) => m.warnings.length) && (
        <div className="rounded-lg border border-border bg-card">
          <h2 className="p-4 border-b border-border font-semibold text-navy">
            Matched, nothing to change
          </h2>
          <ul className="divide-y divide-border">
            {preview.unchanged
              .filter((m) => m.warnings.length)
              .slice(0, 200)
              .map((m) => (
                <MatchedItem key={m.row} match={m} />
              ))}
          </ul>
        </div>
      )}

      {preview.unmatched.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold text-navy">Unmatched rows</h2>
            <p className="text-xs text-muted-foreground">Not changed. Handle these by hand.</p>
          </div>
          <ul className="divide-y divide-border text-sm">
            {preview.unmatched.slice(0, 1000).map((u) => (
              <li key={u.row} className="p-3 flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="text-muted-foreground">Row {u.row}</span>
                <span className="font-mono break-all">{u.claimNumber ?? "—"}</span>
                <span className="text-muted-foreground">{u.reason}</span>
              </li>
            ))}
          </ul>
          {preview.unmatched.length > 1000 && (
            <p className="p-4 text-xs text-muted-foreground">
              …and {preview.unmatched.length - 1000} more
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function MatchedItem({ match }: { match: MatchedRow }) {
  return (
    <li className="p-4 space-y-1.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <Link
          to="/claims/$claimId"
          params={{ claimId: match.claimId }}
          className="font-mono font-medium text-navy hover:text-gold-text break-all"
        >
          {match.claimNumber}
        </Link>
        {match.clientName && <span className="text-muted-foreground">{match.clientName}</span>}
        <span className="text-xs text-muted-foreground">Row {match.row}</span>
      </div>
      {match.changes.length > 0 && (
        <ul className="space-y-0.5">
          {match.changes.map((c) => (
            <li key={c.field} className="break-words">
              {describeChange(c)}
            </li>
          ))}
        </ul>
      )}
      {match.warnings.map((w) => (
        <p key={w} className="text-xs text-amber-700">
          {w}
        </p>
      ))}
    </li>
  );
}

function ApplyResult({ result }: { result: CarrierImportApplyResult }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 text-sm space-y-2">
      <h2 className="font-medium text-navy">Import finished</h2>
      <p>
        Updated <b>{result.updated}</b> claim{result.updated === 1 ? "" : "s"}.
        {result.unchanged + result.unmatched > 0 &&
          ` ${result.unchanged + result.unmatched} changed elsewhere since the preview and were skipped.`}
      </p>
      {result.failed.length > 0 && (
        <ul className="text-xs text-destructive space-y-0.5">
          {result.failed.map((f) => (
            <li key={f.row}>
              Row {f.row} ({f.claimNumber}): {f.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
