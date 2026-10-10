import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchAll } from "@/lib/fetch-all";
import { isExcludedClient, parseMoney, type ImportKind } from "@/lib/import-mapping";

type Db = SupabaseClient<Database>;
type Row = Record<string, unknown>;
type CsvRow = Record<string, string>;

export interface ImportInput {
  kind: ImportKind;
  /** Rows already mapped to field names by mapRows() in import-mapping.ts. */
  rows: CsvRow[];
  dryRun: boolean;
}

export interface ImportResult {
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: { row: number; reason: string }[];
  /** Clients a policy import created (or would create) because they weren't on file yet. */
  newClients: string[];
}

interface Incoming {
  /** identities this row can be matched on, most specific first */
  keys: string[];
  /** only the columns the file actually had a value for */
  values: Row;
}

const WRITE_BATCH = 500;

// Columns the importer owns, with the value a brand-new row gets when the file
// doesn't supply one. Every insert sends all of them, because a bulk insert
// with uneven keys would write NULL (not the column default) for the gaps.
const BLANK = {
  clients: { name: "", company_name: null, email: null, phone: null, ams360_id: null },
  policies: {
    client_id: null,
    policy_number: "",
    policy_type: null,
    carrier: null,
    effective_date: null,
    expiration_date: null,
    premium: null,
  },
  claims: {
    client_id: null,
    claim_number: null,
    claim_type: "Other",
    line_of_business_description: null,
    status: "Open",
    carrier: null,
    policy_number: null,
    date_of_loss: null,
    date_reported: null,
    closed_date: null,
    paid_amount: null,
    reserve_amount: null,
    adjuster_name: null,
    adjuster_email: null,
    adjuster_phone: null,
    description: null,
    is_notice_only: false,
  },
} satisfies Record<string, Row>;

type Table = keyof typeof BLANK;

function parseDate(value: string | undefined): string | null | undefined {
  if (!value) return undefined;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  // US-style month first, which is what BRQR's exports use.
  const us = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/.exec(value);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function isDateColumn(column: string): boolean {
  return column.endsWith("_date") || column.startsWith("date_");
}

function same(column: string, a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  if (isDateColumn(column)) return String(a).slice(0, 10) === String(b).slice(0, 10);
  return String(a) === String(b);
}

function nameKey(name: string): string {
  return `name:${name.trim().toLowerCase()}`;
}

function clientKeys(c: { ams360_id?: unknown; name?: unknown; company_name?: unknown }): string[] {
  const keys: string[] = [];
  if (c.ams360_id) keys.push(`number:${String(c.ams360_id).trim().toLowerCase()}`);
  if (c.company_name) keys.push(nameKey(String(c.company_name)));
  if (c.name) keys.push(nameKey(String(c.name)));
  return keys;
}

function policyKeys(p: Row): string[] {
  return [`${p.client_id}|${String(p.policy_number).toLowerCase()}|${p.effective_date ?? ""}`];
}

function claimKeys(c: Row): string[] {
  if (c.claim_number) return [`${c.client_id}|#${String(c.claim_number).toLowerCase()}`];
  // No claim number to go on: treat same client + loss date + type + policy as the same claim.
  return [
    `${c.client_id}|${String(c.date_of_loss ?? "").slice(0, 10)}|${c.claim_type ?? "Other"}|${c.policy_number ?? ""}`,
  ];
}

type WriteResult = PromiseLike<{ error: { message: string } | null }>;

// The importer picks its table and column list at runtime, which the generated
// per-table types can't follow, so it talks to the tables through this narrow shape.
interface LooseTable {
  select(columns: string): {
    order(column: string): {
      range(from: number, to: number): PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
    };
  };
  insert(rows: Row[]): WriteResult;
  upsert(rows: Row[], options: { onConflict: string }): WriteResult;
}

function looseTable(supabase: Db, table: Table): LooseTable {
  return supabase.from(table) as unknown as LooseTable;
}

async function loadTable(supabase: Db, table: Table): Promise<Row[]> {
  const columns = ["id", ...Object.keys(BLANK[table])].join(", ");
  return fetchAll<Row>((from, to) => looseTable(supabase, table).select(columns).order("id").range(from, to));
}

async function insertRows(supabase: Db, table: Table, rows: Row[]) {
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const { error } = await looseTable(supabase, table).insert(rows.slice(i, i + WRITE_BATCH));
    if (error) throw new Error(error.message);
  }
}

// Matches incoming rows against what is already stored and writes the difference.
async function applyRows(
  supabase: Db,
  table: Table,
  existing: Row[],
  keysOf: (row: Row) => string[],
  incoming: Incoming[],
  dryRun: boolean,
): Promise<Pick<ImportResult, "inserted" | "updated" | "unchanged">> {
  const columns = Object.keys(BLANK[table]);
  const byKey = new Map<string, Row>();
  for (const row of existing) {
    for (const key of keysOf(row)) if (!byKey.has(key)) byKey.set(key, row);
  }

  const inserts: Row[] = [];
  const updates = new Map<string, Row>();
  const matched = new Set<string>();

  for (const item of incoming) {
    const target = item.keys.map((k) => byKey.get(k)).find(Boolean);

    if (!target) {
      const row = { ...BLANK[table], ...item.values };
      inserts.push(row);
      // Register it so a repeat of the same record further down the file merges into it.
      for (const key of item.keys) byKey.set(key, row);
      continue;
    }

    if (!target.id) {
      // Repeat of a row that is itself new in this file.
      Object.assign(target, item.values);
      continue;
    }

    const id = String(target.id);
    matched.add(id);
    const changed = columns.some((c) => c in item.values && !same(c, item.values[c], target[c]));
    if (changed) {
      Object.assign(target, item.values);
      updates.set(id, target);
    }
  }

  if (!dryRun) {
    await insertRows(supabase, table, inserts);
    const updateRows = [...updates.values()];
    for (let i = 0; i < updateRows.length; i += WRITE_BATCH) {
      const { error } = await looseTable(supabase, table).upsert(updateRows.slice(i, i + WRITE_BATCH), {
        onConflict: "id",
      });
      if (error) throw new Error(error.message);
    }
  }

  return { inserted: inserts.length, updated: updates.size, unchanged: matched.size - updates.size };
}

function setIfPresent(values: Row, column: string, value: unknown) {
  if (value !== undefined) values[column] = value;
}

function rowNumber(csv: CsvRow, index: number): number {
  return Number(csv.source_row) || index + 2;
}

function clientRef(csv: CsvRow): string {
  return csv.client_number || csv.client_name || "(blank)";
}

function clientsIncoming(rows: CsvRow[], skipped: ImportResult["skipped"]): Incoming[] {
  const incoming: Incoming[] = [];
  rows.forEach((csv, i) => {
    const name = csv.name || csv.company_name;
    if (!name) {
      skipped.push({ row: rowNumber(csv, i), reason: "No name or company" });
      return;
    }
    if (isExcludedClient(name)) return;
    const values: Row = { name };
    setIfPresent(values, "company_name", csv.company_name);
    setIfPresent(values, "email", csv.email);
    setIfPresent(values, "phone", csv.phone);
    setIfPresent(values, "ams360_id", csv.client_number);
    incoming.push({ keys: clientKeys(values), values });
  });
  return incoming;
}

type ClientResolver = (csv: CsvRow) => string | null;

// Policies and claims point at a client by number or name; resolve that to the clients row id.
function clientResolver(clients: Row[]): ClientResolver {
  const byKey = new Map<string, string>();
  for (const c of clients) {
    for (const key of clientKeys(c)) if (!byKey.has(key)) byKey.set(key, String(c.id));
  }
  return (csv) => {
    const keys = clientKeys({ ams360_id: csv.client_number, name: csv.client_name });
    return keys.map((k) => byKey.get(k)).find(Boolean) ?? null;
  };
}

// A book of business is the source of truth for who the clients are, so a
// policy import adds any client it doesn't recognise instead of skipping
// their policies. The names come back in the result so a surprise (e.g. a
// client renamed in the source system) is visible in the "Check file" step.
async function ensureClients(
  supabase: Db,
  rows: CsvRow[],
  dryRun: boolean,
): Promise<{ resolve: ClientResolver; newClients: string[] }> {
  const clients = await loadTable(supabase, "clients");
  const resolve = clientResolver(clients);

  const missing = new Map<string, Row>();
  for (const csv of rows) {
    if (!csv.client_name || isExcludedClient(csv.client_name) || resolve(csv)) continue;
    const key = nameKey(csv.client_name);
    if (!missing.has(key)) {
      missing.set(key, { ...BLANK.clients, name: csv.client_name, ams360_id: csv.client_number ?? null });
    }
  }
  const newClients = [...missing.values()].map((c) => String(c.name));
  if (missing.size === 0) return { resolve, newClients };

  if (dryRun) {
    // Nothing is written; stand-in ids just let the policies be counted as new.
    const standIns = [...missing.entries()].map(([key, c]) => ({ ...c, id: `new:${key}` }));
    return { resolve: clientResolver([...clients, ...standIns]), newClients };
  }

  await insertRows(supabase, "clients", [...missing.values()]);
  return { resolve: clientResolver(await loadTable(supabase, "clients")), newClients };
}

function policiesIncoming(rows: CsvRow[], resolveClient: ClientResolver, skipped: ImportResult["skipped"]): Incoming[] {
  const incoming: Incoming[] = [];
  rows.forEach((csv, i) => {
    if (isExcludedClient(csv.client_name)) return;
    const row = rowNumber(csv, i);
    const clientId = resolveClient(csv);
    if (!clientId) {
      skipped.push({ row, reason: `Client not found: ${clientRef(csv)}` });
      return;
    }
    if (!csv.policy_number) {
      skipped.push({ row, reason: "No policy number" });
      return;
    }
    const values: Row = { client_id: clientId, policy_number: csv.policy_number };
    setIfPresent(values, "policy_type", csv.policy_type);
    setIfPresent(values, "carrier", csv.carrier);
    setIfPresent(values, "effective_date", parseDate(csv.effective_date));
    setIfPresent(values, "expiration_date", parseDate(csv.expiration_date));
    setIfPresent(values, "premium", parseMoney(csv.premium));
    incoming.push({ keys: policyKeys(values), values });
  });
  return incoming;
}

function claimsIncoming(rows: CsvRow[], resolveClient: ClientResolver, skipped: ImportResult["skipped"]): Incoming[] {
  const incoming: Incoming[] = [];
  rows.forEach((csv, i) => {
    if (isExcludedClient(csv.client_name)) return;
    const clientId = resolveClient(csv);
    if (!clientId) {
      skipped.push({ row: rowNumber(csv, i), reason: `Client not found: ${clientRef(csv)}` });
      return;
    }
    const values: Row = { client_id: clientId };
    for (const column of [
      "claim_number",
      "claim_type",
      "line_of_business_description",
      "status",
      "carrier",
      "policy_number",
      "adjuster_name",
      "adjuster_email",
      "adjuster_phone",
      "description",
    ]) {
      setIfPresent(values, column, csv[column]);
    }
    setIfPresent(values, "date_of_loss", parseDate(csv.date_of_loss));
    setIfPresent(values, "date_reported", parseDate(csv.date_reported));
    setIfPresent(values, "closed_date", parseDate(csv.closed_date));
    setIfPresent(values, "paid_amount", parseMoney(csv.paid_amount));
    setIfPresent(values, "reserve_amount", parseMoney(csv.reserve_amount));
    incoming.push({ keys: claimKeys(values), values });
  });
  return incoming;
}

// `supabase` must carry an agency_admin's own token: the "admin manages ..."
// RLS policies are what authorize every read and write here.
export async function runImport(supabase: Db, input: ImportInput): Promise<ImportResult> {
  const { kind, rows, dryRun } = input;
  const skipped: ImportResult["skipped"] = [];

  if (kind === "clients") {
    const incoming = clientsIncoming(rows, skipped);
    const existing = await loadTable(supabase, "clients");
    const counts = await applyRows(supabase, "clients", existing, clientKeys, incoming, dryRun);
    return { ...counts, skipped, newClients: [] };
  }

  if (kind === "policies") {
    const { resolve, newClients } = await ensureClients(supabase, rows, dryRun);
    const incoming = policiesIncoming(rows, resolve, skipped);
    const existing = await loadTable(supabase, "policies");
    const counts = await applyRows(supabase, "policies", existing, policyKeys, incoming, dryRun);
    return { ...counts, skipped, newClients };
  }

  const resolve = clientResolver(await loadTable(supabase, "clients"));
  const incoming = claimsIncoming(rows, resolve, skipped);
  const existing = await loadTable(supabase, "claims");
  const counts = await applyRows(supabase, "claims", existing, claimKeys, incoming, dryRun);
  return { ...counts, skipped, newClients: [] };
}
