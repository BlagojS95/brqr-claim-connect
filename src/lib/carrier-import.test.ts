import { describe, expect, it } from "vitest";
import { CLAIM_STATUS } from "@/lib/claim-status";
import { claimUpdateActivityBody } from "@/lib/claim-quick-edit";
import {
  CarrierMappingSchema,
  CarrierRowSchema,
  applyCarrierMapping,
  buildCarrierImportPreview,
  carrierStatus,
  distinctCarriers,
  guessCarrierMapping,
  ilikeExact,
  normalizeClaimNumber,
  parseImportDate,
  rowValues,
  usableMapping,
  type CarrierClaim,
  type CarrierRow,
} from "@/lib/carrier-import";

function claim(over: Partial<CarrierClaim> = {}): CarrierClaim {
  return {
    id: "c1",
    client_name: "Acme Co",
    claim_number: "TRV-123",
    adjuster_name: null,
    adjuster_phone: null,
    adjuster_email: null,
    status: CLAIM_STATUS.open,
    paid_amount: 0,
    reserve_amount: 0,
    waiting_on: null,
    assigned_to: null,
    submitted_to_carrier_at: null,
    first_carrier_contact_at: null,
    closed_date: null,
    ...over,
  };
}

const row = (n: number, values: CarrierRow["values"]): CarrierRow => ({ row: n, values });

describe("normalizeClaimNumber", () => {
  it("ignores case and spaces", () => {
    expect(normalizeClaimNumber(" trv 123 ")).toBe(normalizeClaimNumber("TRV123"));
    expect(normalizeClaimNumber(null)).toBe("");
  });
});

describe("carrierStatus", () => {
  it("maps carrier words onto the claim_status enum", () => {
    expect(carrierStatus("Closed", CLAIM_STATUS.open)).toBe(CLAIM_STATUS.closed);
    expect(carrierStatus("CLOSED - PAID", CLAIM_STATUS.open)).toBe(CLAIM_STATUS.closed);
    expect(carrierStatus("Open", CLAIM_STATUS.submitted)).toBe(CLAIM_STATUS.open);
    expect(carrierStatus("Re-opened", CLAIM_STATUS.closed)).toBe(CLAIM_STATUS.reopened);
    expect(carrierStatus("Reopened", CLAIM_STATUS.open)).toBe(CLAIM_STATUS.reopened);
  });

  it("treats Open on a closed claim as reopened, and keeps reopened", () => {
    expect(carrierStatus("Open", CLAIM_STATUS.closed)).toBe(CLAIM_STATUS.reopened);
    expect(carrierStatus("Open", CLAIM_STATUS.reopened)).toBe(CLAIM_STATUS.reopened);
  });

  it("leaves blanks and unknown words alone", () => {
    expect(carrierStatus("", CLAIM_STATUS.open)).toBeUndefined();
    expect(carrierStatus(undefined, CLAIM_STATUS.open)).toBeUndefined();
    expect(carrierStatus("Subrogation", CLAIM_STATUS.open)).toBe("unknown");
  });
});

describe("parseImportDate", () => {
  it("reads ISO and US dates as calendar dates", () => {
    expect(parseImportDate("2026-03-05")).toBe("2026-03-05");
    expect(parseImportDate("2026-3-5T00:00:00Z")).toBe("2026-03-05");
    expect(parseImportDate("3/5/2026")).toBe("2026-03-05");
    expect(parseImportDate("03-05-26")).toBe("2026-03-05");
    expect(parseImportDate("12/31/2025 11:59 PM")).toBe("2025-12-31");
  });

  it("rejects impossible or unreadable dates", () => {
    expect(parseImportDate("2/30/2026")).toBeNull();
    expect(parseImportDate("13/01/2026")).toBeNull();
    expect(parseImportDate("soon")).toBeNull();
    expect(parseImportDate("2/29/2028")).toBe("2028-02-29");
  });
});

describe("rowValues", () => {
  it("normalises money like $1,234.50", () => {
    const { next, warnings } = rowValues(
      { paid_amount: "$1,234.50", reserve_amount: "5,000" },
      claim(),
    );
    expect(next).toEqual({ paid_amount: 1234.5, reserve_amount: 5000 });
    expect(warnings).toEqual([]);
  });

  it("skips bad cells with a warning instead of failing", () => {
    const { next, warnings } = rowValues(
      {
        paid_amount: "N/A",
        reserve_amount: "(100)",
        closed_date: "later",
        adjuster_email: "nope",
        status: "Huh",
      },
      claim(),
    );
    expect(next).toEqual({});
    expect(warnings).toHaveLength(5);
  });
});

describe("buildCarrierImportPreview", () => {
  it("matches by claim number ignoring case and spaces, and lists the changes", () => {
    const preview = buildCarrierImportPreview(
      [
        row(2, {
          claim_number: " trv -123",
          status: "Closed",
          paid_amount: "$2,500",
          closed_date: "3/5/2026",
          adjuster_name: "Ann",
        }),
      ],
      [claim()],
    );
    expect(preview.unmatched).toEqual([]);
    expect(preview.changed).toHaveLength(1);
    const [m] = preview.changed;
    expect(m.claimId).toBe("c1");
    expect(m.update).toEqual({
      status: CLAIM_STATUS.closed,
      paid_amount: 2500,
      closed_date: "2026-03-05",
      adjuster_name: "Ann",
    });
    // The import doesn't stamp first carrier contact; that's quick edit only.
    expect(m.update.first_carrier_contact_at).toBeUndefined();
    expect(claimUpdateActivityBody(m.changes, "Updated from Travelers import: ")).toBe(
      "Updated from Travelers import: Closed date changed from — to 3/5/2026; Paid changed from $0 to $2,500; Adjuster changed from — to Ann",
    );
  });

  it("lists unmatched rows with a reason", () => {
    const preview = buildCarrierImportPreview(
      [row(2, { claim_number: "XYZ-9" }), row(3, { paid_amount: "10" })],
      [claim()],
    );
    expect(preview.changed).toEqual([]);
    expect(preview.unmatched).toEqual([
      { row: 2, claimNumber: "XYZ-9", reason: "No claim with this number for this carrier" },
      { row: 3, claimNumber: null, reason: "No claim number" },
    ]);
  });

  it("puts rows that change nothing under unchanged, and blank cells never clear values", () => {
    const stored = claim({ paid_amount: 1234.5, adjuster_name: "Ann" });
    const preview = buildCarrierImportPreview(
      [row(2, { claim_number: "TRV-123", paid_amount: "1234.50", status: "Open" })],
      [stored],
    );
    expect(preview.changed).toEqual([]);
    expect(preview.unchanged).toHaveLength(1);
    expect(preview.unchanged[0].update).toEqual({});
  });

  it("uses a claim number only once per file", () => {
    const preview = buildCarrierImportPreview(
      [
        row(2, { claim_number: "TRV-123", paid_amount: "1" }),
        row(5, { claim_number: "trv-123", paid_amount: "2" }),
      ],
      [claim()],
    );
    expect(preview.changed.map((m) => m.row)).toEqual([2]);
    expect(preview.unmatched).toEqual([
      { row: 5, claimNumber: "trv-123", reason: "Same claim number as row 2" },
    ]);
  });

  it("won't guess when two claims share a number", () => {
    const preview = buildCarrierImportPreview(
      [row(2, { claim_number: "TRV-123", paid_amount: "1" })],
      [claim(), claim({ id: "c2", claim_number: "trv-123 " })],
    );
    expect(preview.changed).toEqual([]);
    expect(preview.unmatched[0].reason).toMatch(/2 claims/);
  });
});

describe("mapping", () => {
  const headers = [
    "Claim Number",
    "Claim Status",
    "Total Paid",
    "Reserve",
    "Adjuster",
    "Adjuster Email",
    "Date Closed",
    "Notes",
  ];

  it("guesses the columns from the headers", () => {
    expect(guessCarrierMapping(headers)).toEqual({
      claim_number: "Claim Number",
      status: "Claim Status",
      paid_amount: "Total Paid",
      reserve_amount: "Reserve",
      adjuster_name: "Adjuster",
      adjuster_email: "Adjuster Email",
      closed_date: "Date Closed",
    });
  });

  it("drops saved columns the file doesn't have", () => {
    expect(
      usableMapping({ claim_number: "Claim Number", paid_amount: "Paid To Date" }, headers),
    ).toEqual({
      claim_number: "Claim Number",
    });
  });

  it("reads rows through the mapping with spreadsheet row numbers", () => {
    const rows = applyCarrierMapping(
      [{ "Claim Number": " TRV-1 ", "Total Paid": "", Notes: "x" }],
      { claim_number: "Claim Number", paid_amount: "Total Paid" },
    );
    expect(rows).toEqual([{ row: 2, values: { claim_number: "TRV-1" } }]);
  });

  it("validates a saved mapping and a row", () => {
    expect(CarrierMappingSchema.safeParse({ paid_amount: "Paid" }).success).toBe(false);
    expect(CarrierMappingSchema.safeParse({ claim_number: "No", other: "x" }).success).toBe(false);
    expect(
      CarrierRowSchema.safeParse({ row: 2, values: { claim_number: "A", bogus: "x" } }).success,
    ).toBe(false);
    expect(CarrierRowSchema.safeParse({ row: 2, values: { claim_number: "A" } }).success).toBe(
      true,
    );
  });
});

describe("helpers", () => {
  it("escapes LIKE wildcards", () => {
    expect(ilikeExact(" A_B%C\\ ")).toBe("A\\_B\\%C\\\\");
  });

  it("lists carriers once, case-insensitively, with counts", () => {
    expect(distinctCarriers(["Travelers", "travelers ", null, "Chubb", ""])).toEqual([
      { name: "Chubb", claims: 1 },
      { name: "Travelers", claims: 2 },
    ]);
  });
});
