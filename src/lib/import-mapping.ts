// Shared by the import screen (preview) and the import server function.
// Column headers are matched loosely: case, spaces and punctuation are ignored,
// so "Client Number", "client_number" and "ClientNumber" are all the same column.

export type ImportKind = "clients" | "policies" | "claims";

export const IMPORT_KINDS: { kind: ImportKind; label: string }[] = [
  { kind: "policies", label: "Policies (Book of Business)" },
  { kind: "clients", label: "Clients" },
  { kind: "claims", label: "Claims" },
];

const CLIENT_NUMBER = ["clientnumber", "clientno", "clientid", "customernumber", "customerno", "customerid", "accountnumber", "accountno", "ams360id"];
const CLIENT_NAME = ["client", "clientname", "customer", "customername", "insured", "insuredname", "firmname", "companyname"];
const CARRIER = ["writingconame", "carrier", "insurer", "writingcompany", "writingcompanyname", "insurancecompany", "company"];
const POLICY_NUMBER = ["policynumber", "policyno", "policy"];

// field -> accepted headers (already normalized). Order of fields matters:
// a header is given to the first field that lists it.
const FIELD_ALIASES: Record<ImportKind, Record<string, string[]>> = {
  clients: {
    client_number: [...CLIENT_NUMBER, "number", "id"],
    name: ["name", "fullname", "contact", "contactname", "clientname", "customer", "customername", "insured", "insuredname"],
    company_name: ["company", "companyname", "firmname", "business", "businessname", "dba"],
    email: ["email", "emailaddress"],
    phone: ["phone", "phonenumber", "telephone", "businessphone", "mobile"],
  },
  // Covers the AMS360 "Policy Book of Business" report as exported
  // (Customer, Policy, PolEffDate, PolExpDate, WritingCoName, LineofBusiness, PrmNonPAgCm).
  // Its commission columns are deliberately not listed, so they are never read.
  policies: {
    client_number: CLIENT_NUMBER,
    client_name: [...CLIENT_NAME, "name"],
    policy_number: [...POLICY_NUMBER, "number"],
    policy_type: ["policytype", "type", "lineofbusiness", "lob", "coverage"],
    carrier: CARRIER,
    effective_date: ["effectivedate", "poleffdate", "effective", "startdate", "inceptiondate"],
    expiration_date: ["expirationdate", "polexpdate", "expirydate", "expiration", "expiry", "expiredate", "enddate"],
    premium: ["premium", "totalpremium", "annualpremium", "prmnonpagcm"],
  },
  claims: {
    client_number: CLIENT_NUMBER,
    client_name: [...CLIENT_NAME, "name"],
    claim_number: ["claimnumber", "claimno", "claimid", "claim"],
    claim_type: ["claimtype", "type", "kindofloss", "losstype"],
    line_of_business_description: ["lineofbusiness", "lineofbusinessdescription", "lob"],
    status: ["status", "claimstatus"],
    carrier: CARRIER,
    policy_number: POLICY_NUMBER,
    date_of_loss: ["dateofloss", "lossdate", "dol", "incidentdate"],
    date_reported: ["datereported", "reportdate", "reporteddate", "reported"],
    closed_date: ["closeddate", "dateclosed", "closed"],
    paid_amount: ["paidamount", "amountpaid", "paid", "totalpaid"],
    reserve_amount: ["reserveamount", "reserve", "reserves"],
    adjuster_name: ["adjuster", "adjustername"],
    adjuster_email: ["adjusteremail"],
    adjuster_phone: ["adjusterphone"],
    description: ["description", "lossdescription", "details"],
  },
};

// Each group needs at least one of its fields present as a column.
const REQUIRED: Record<ImportKind, string[][]> = {
  clients: [["name", "company_name"]],
  policies: [["client_number", "client_name"], ["policy_number"]],
  claims: [["client_number", "client_name"]],
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// The agency's own account shows up in its book of business. It is not a
// portal client, so it is left out of every import.
const EXCLUDED_CLIENTS = ["brokerquickresponse"];

export function isExcludedClient(name: string | undefined): boolean {
  if (!name) return false;
  const n = normalize(name);
  return EXCLUDED_CLIENTS.some((excluded) => n.startsWith(excluded));
}

export function parseMoney(value: string | undefined): number | null | undefined {
  if (!value) return undefined;
  const negative = /^\(.*\)$/.test(value) || value.startsWith("-");
  const n = Number(value.replace(/[^0-9.]/g, ""));
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}

export interface HeaderMapping {
  /** field -> the column header it is read from */
  fields: Record<string, string>;
  ignored: string[];
  /** human-readable list of what is missing, empty when the file is usable */
  missing: string[];
}

export function mapHeaders(kind: ImportKind, headers: string[]): HeaderMapping {
  const fields: Record<string, string> = {};
  const used = new Set<string>();

  for (const [field, aliases] of Object.entries(FIELD_ALIASES[kind])) {
    const header = headers.find((h) => !used.has(h) && aliases.includes(normalize(h)));
    if (header) {
      fields[field] = header;
      used.add(header);
    }
  }

  const missing = REQUIRED[kind]
    .filter((group) => !group.some((field) => fields[field]))
    .map((group) => group.join(" or "));

  return { fields, ignored: headers.filter((h) => !used.has(h)), missing };
}

// `source_row` is the row number as seen in the spreadsheet (header is row 1),
// so skipped-row messages point at something the user can find.
export function mapRows(rows: Record<string, string>[], mapping: HeaderMapping): Record<string, string>[] {
  return rows.map((row, i) => {
    const out: Record<string, string> = { source_row: String(i + 2) };
    for (const [field, header] of Object.entries(mapping.fields)) {
      const value = (row[header] ?? "").trim();
      if (value) out[field] = value;
    }
    return out;
  });
}

export interface SheetRecords {
  headers: string[];
  rows: Record<string, string>[];
}

// Turns a worksheet (array of rows, first row = headers) into the same
// header-keyed string records a CSV parse gives.
export function sheetToRecords(data: unknown[][]): SheetRecords {
  const headers = (data[0] ?? []).map((h) => String(h ?? "").trim());
  const rows = data
    .slice(1)
    .filter((cells) => cells.some((c) => c != null && c !== ""))
    .map((cells) => {
      const record: Record<string, string> = {};
      headers.forEach((header, i) => {
        if (!header) return;
        const cell = cells[i];
        record[header] = cell instanceof Date ? cell.toISOString().slice(0, 10) : cell == null ? "" : String(cell);
      });
      return record;
    });
  return { headers: headers.filter(Boolean), rows };
}

const TAX_OR_FEE = /\b(tax|fee|fees|surcharge)\b/i;

// The Book of Business report has several lines per policy: one per coverage
// plus separate lines for taxes and fees. This folds them into one row per
// policy: type and carrier come from the coverage line(s), and every line's
// amount is added into the premium so it matches what the client is billed.
export function rollUpPolicies(rows: Record<string, string>[]): Record<string, string>[] {
  const groups = new Map<string, Record<string, string>[]>();
  const out: Record<string, string>[][] = [];

  for (const row of rows) {
    if (!row.policy_number) {
      out.push([row]);
      continue;
    }
    const key = [row.client_number ?? "", row.client_name ?? "", row.policy_number, row.effective_date ?? ""]
      .join("|")
      .toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
      out.push(group);
    }
    group.push(row);
  }

  return out.map((group) => {
    if (group.length === 1 && !group[0].premium) return group[0];

    const coverage = group.filter((r) => r.policy_type && !TAX_OR_FEE.test(r.policy_type));
    const types = [...new Set(coverage.map((r) => r.policy_type))];
    const carrier = coverage.find((r) => r.carrier)?.carrier;
    const amounts = group.map((r) => parseMoney(r.premium)).filter((n): n is number => typeof n === "number");

    const { policy_type: _type, carrier: _carrier, premium: _premium, ...base } = group[0];
    const merged: Record<string, string> = { ...base };
    if (types.length) merged.policy_type = types.join(" / ");
    if (carrier) merged.carrier = carrier;
    if (amounts.length) merged.premium = (Math.round(amounts.reduce((s, n) => s + n, 0) * 100) / 100).toString();
    return merged;
  });
}
