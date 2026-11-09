import { describe, expect, it } from "vitest";
import { CLAIM_STATUS } from "@/lib/claim-status";
import { totalIncurred, totalPaid } from "@/lib/claim-metrics";
import { buildClaimsExport, claimsToExport, toCsv } from "@/lib/exports/claims-export";
import { exportFileName, guardFormula, type ExportTable } from "@/lib/exports/table";
import type { AgencyClaim } from "@/lib/overview.types";

const base: AgencyClaim = {
  id: "c0",
  claim_number: null,
  claim_type: "Slip and fall",
  claimant_name: null,
  line_of_business: "General Liability",
  status: CLAIM_STATUS.open,
  is_notice_only: false,
  carrier: null,
  date_of_loss: null,
  closed_date: null,
  date_reported: null,
  paid_amount: null,
  reserve_amount: null,
  recovery_amount: null,
  adjuster_name: null,
  policy_number: null,
  description: null,
  client_id: "client-1",
  client_name: "Acme Roofing",
  waiting_on: null,
  last_activity_at: null,
  created_at: "2026-01-01T00:00:00Z",
  cause_of_loss_id: null,
  cause_of_loss: null,
  loss_location: null,
  employee_name: null,
  driver_name: null,
  vehicles_involved: null,
};

const claim = (fields: Partial<AgencyClaim>): AgencyClaim => ({ ...base, ...fields });

const claims = [
  claim({
    id: "a",
    claim_number: "GL-100",
    carrier: "Chubb",
    date_of_loss: "2026-03-05",
    paid_amount: 1000,
    reserve_amount: 500,
    recovery_amount: 200,
  }),
  claim({
    id: "b",
    claim_number: "GL-200",
    carrier: "Travelers",
    status: CLAIM_STATUS.closed,
    date_of_loss: "2025-12-31",
    closed_date: "2026-02-01T00:00:00+00:00",
    paid_amount: 4000,
  }),
  claim({
    id: "c",
    claim_number: "WC-300",
    carrier: "Chubb",
    line_of_business: "Workers Compensation",
    date_of_loss: "2026-06-01",
    reserve_amount: 2500,
    waiting_on: "carrier",
    cause_of_loss: "Strain",
    claimant_name: "Pat Lee",
    adjuster_name: "Sam Ortiz",
    date_reported: "2026-06-02",
  }),
];

describe("claimsToExport", () => {
  it("applies the list's filter and sort across every page", () => {
    const rows = claimsToExport(claims, { q: "chubb", sort: "paid", dir: "desc" });
    expect(rows.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("applies the fix 31 search fields and filters, the same as the list", () => {
    expect(claimsToExport(claims, { q: "pat lee" }).map((c) => c.id)).toEqual(["c"]);
    expect(claimsToExport(claims, { year: 2026, carrier: "chubb" }).map((c) => c.id)).toEqual([
      "c",
      "a",
    ]);
    expect(
      claimsToExport(claims, { line: "Workers Compensation", year: 2025 }).map((c) => c.id),
    ).toEqual([]);
  });

  it("uses the list's default sort (newest loss first) without sort params", () => {
    expect(claimsToExport(claims, {}).map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("ignores the page, so all rows are exported", () => {
    const many = Array.from({ length: 60 }, (_, i) => claim({ id: String(i) }));
    expect(claimsToExport(many, { page: 2 })).toHaveLength(60);
  });

  it("keeps the status filter's meaning (open includes reopened)", () => {
    const list = [...claims, claim({ id: "r", status: CLAIM_STATUS.reopened })];
    expect(
      claimsToExport(list, { status: "open" })
        .map((c) => c.id)
        .sort(),
    ).toEqual(["a", "c", "r"]);
  });
});

describe("buildClaimsExport", () => {
  it("has the agreed columns, with Client only for admins", () => {
    const labels = buildClaimsExport(claims, { includeClient: false }).columns.map((c) => c.label);
    expect(labels).toEqual([
      "Claim #",
      "Status",
      "Waiting on",
      "Type",
      "Line of business",
      "Cause of loss",
      "Date of loss",
      "Reported",
      "Closed",
      "Carrier",
      "Claimant",
      "Adjuster",
      "Paid",
      "Reserve",
      "Recoveries",
      "Incurred",
    ]);
    const admin = buildClaimsExport(claims, { includeClient: true });
    expect(admin.columns.at(-1)?.label).toBe("Client");
    expect(admin.rows[0].at(-1)).toBe("Acme Roofing");
  });

  it("formats labels and calendar dates without shifting the day", () => {
    const [row] = buildClaimsExport([claims[2]], { includeClient: false }).rows;
    expect(row).toEqual([
      "WC-300",
      "Open",
      "Carrier",
      "Slip and fall",
      "Workers Compensation",
      "Strain",
      "6/1/2026",
      "6/2/2026",
      null,
      "Chubb",
      "Pat Lee",
      "Sam Ortiz",
      0,
      2500,
      0,
      2500,
    ]);
    const closed = buildClaimsExport([claims[1]], { includeClient: false }).rows[0];
    expect(closed[8]).toBe("2/1/2026");
    expect(closed[6]).toBe("12/31/2025");
  });

  it("ends with a totals row matching claim-metrics", () => {
    const table = buildClaimsExport(claims, { includeClient: false });
    expect(table.totals).toEqual([
      "Total (3 claims)",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      totalPaid(claims),
      3000,
      200,
      totalIncurred(claims),
    ]);
    expect(totalIncurred(claims)).toBe(8000);
  });

  it("says claim, not claims, for one row", () => {
    expect(buildClaimsExport([claims[0]], { includeClient: false }).totals?.[0]).toBe(
      "Total (1 claim)",
    );
  });
});

describe("toCsv", () => {
  const table = (rows: ExportTable["rows"]): ExportTable => ({
    columns: [
      { label: "Name", kind: "text" },
      { label: "Paid", kind: "money" },
    ],
    rows,
    totals: null,
  });

  it("writes RFC 4180: CRLF lines, quotes doubled, fields with commas or newlines quoted", () => {
    const csv = toCsv(
      table([
        ['Smith, "Bob"', 12.5],
        ["line1\nline2", null],
        ["plain", 0],
      ]),
    );
    expect(csv).toBe('Name,Paid\r\n"Smith, ""Bob""",12.5\r\n"line1\nline2",\r\nplain,0\r\n');
  });

  it("neutralises formula injection in text cells", () => {
    const csv = toCsv(
      table([
        ['=HYPERLINK("http://x")', 1],
        ["+1+1", 1],
        ["-2", 1],
        ["@SUM(A1)", 1],
        ["\tx", 1],
      ]),
    );
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://x"")",1`);
    expect(lines[2]).toBe("'+1+1,1");
    expect(lines[3]).toBe("'-2,1");
    expect(lines[4]).toBe("'@SUM(A1),1");
    expect(lines[5]).toBe("'\tx,1");
  });

  it("guards a carriage return at the start too", () => {
    expect(guardFormula("\r=1")).toBe("'\r=1");
    expect(guardFormula("Safe = text")).toBe("Safe = text");
  });

  it("keeps negative money as a number", () => {
    expect(toCsv(table([["Refund", -250]]))).toContain("Refund,-250\r\n");
  });

  it("appends the totals row", () => {
    const csv = toCsv(buildClaimsExport(claims, { includeClient: false }));
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(5);
    expect(lines[4]).toBe("Total (3 claims),,,,,,,,,,,,5000,3000,200,8000");
  });
});

describe("exportFileName", () => {
  it("dates the file", () => {
    expect(exportFileName("claims", "2026-11-09", "csv")).toBe("claims-2026-11-09.csv");
  });
});
