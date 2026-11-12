import { describe, expect, it } from "vitest";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";
import {
  NOT_GIVEN,
  largestClaimsMeasure,
  largestOpenClaims,
  topRows,
  totalsByCause,
  totalsByLocation,
  type BreakdownRow,
} from "@/lib/insights-breakdowns";

interface TestClaim {
  id: string;
  claim_number: string | null;
  status: ClaimStatus;
  paid_amount: number | null;
  reserve_amount: number | null;
  cause_of_loss: string | null;
  loss_location: string | null;
  location_name?: string | null;
}

let seq = 0;
const claim = (overrides: Partial<TestClaim> = {}): TestClaim => ({
  id: `c${++seq}`,
  claim_number: null,
  status: CLAIM_STATUS.open,
  paid_amount: 0,
  reserve_amount: 0,
  cause_of_loss: null,
  loss_location: null,
  ...overrides,
});

const byName = (rows: BreakdownRow[]) => Object.fromEntries(rows.map((r) => [r.name, r]));

describe("totalsByCause", () => {
  it("totals count, incurred and paid per cause", () => {
    const rows = byName(
      totalsByCause([
        claim({ cause_of_loss: "Fire or smoke", paid_amount: 100, reserve_amount: 50 }),
        claim({ cause_of_loss: "Fire or smoke", paid_amount: null, reserve_amount: 25 }),
        claim({ cause_of_loss: "Vandalism", paid_amount: 10, reserve_amount: null }),
      ]),
    );
    expect(rows["Fire or smoke"]).toEqual({
      name: "Fire or smoke",
      count: 2,
      incurred: 175,
      paid: 100,
      filter: { cause: "Fire or smoke" },
    });
    expect(rows["Vandalism"]).toEqual({
      name: "Vandalism",
      count: 1,
      incurred: 10,
      paid: 10,
      filter: { cause: "Vandalism" },
    });
  });

  it("groups claims without a cause as Not given", () => {
    const rows = byName(
      totalsByCause([claim(), claim({ cause_of_loss: "  " }), claim({ cause_of_loss: "Other" })]),
    );
    expect(rows[NOT_GIVEN].count).toBe(2);
    expect(rows["Other"].count).toBe(1);
  });
});

describe("totalsByLocation", () => {
  it("groups locations ignoring case and extra spaces, keeping the first spelling", () => {
    const rows = totalsByLocation([
      claim({ loss_location: "Warehouse 3", paid_amount: 5 }),
      claim({ loss_location: "  warehouse   3 ", paid_amount: 7 }),
      claim({ loss_location: "WAREHOUSE 3" }),
      claim({ loss_location: "Main St Store" }),
    ]);
    expect(byName(rows)).toEqual({
      "Warehouse 3": {
        name: "Warehouse 3",
        count: 3,
        incurred: 12,
        paid: 12,
        filter: { location: "Warehouse 3" },
      },
      "Main St Store": {
        name: "Main St Store",
        count: 1,
        incurred: 0,
        paid: 0,
        filter: { location: "Main St Store" },
      },
    });
  });

  it("uses the client's site name before the loss location text (fix 32)", () => {
    const rows = byName(
      totalsByLocation([
        claim({ location_name: "Dayton Yard", loss_location: "Bay 4", paid_amount: 5 }),
        claim({ location_name: "dayton yard" }),
        claim({ loss_location: "Bay 4" }),
      ]),
    );
    expect(Object.keys(rows).sort()).toEqual(["Bay 4", "Dayton Yard"]);
    expect(rows["Dayton Yard"].count).toBe(2);
  });

  it("groups blank and missing locations as Not given", () => {
    const rows = byName(
      totalsByLocation([claim(), claim({ loss_location: "" }), claim({ loss_location: " \t " })]),
    );
    expect(Object.keys(rows)).toEqual([NOT_GIVEN]);
    expect(rows[NOT_GIVEN].count).toBe(3);
  });
});

describe("topRows", () => {
  const rows: BreakdownRow[] = [
    { name: "A", count: 1, incurred: 500, paid: 0 },
    { name: "B", count: 5, incurred: 100, paid: 50 },
    { name: "C", count: 3, incurred: 300, paid: 200 },
    { name: "D", count: 2, incurred: 0, paid: 0 },
  ];

  it("sorts by the selected measure", () => {
    expect(topRows(rows, "count", 10, "Other").map((r) => r.name)).toEqual(["B", "C", "D", "A"]);
    expect(topRows(rows, "incurred", 10, "Other").map((r) => r.name)).toEqual(["A", "C", "B"]);
    expect(topRows(rows, "paid", 10, "Other").map((r) => r.name)).toEqual(["C", "B"]);
  });

  it("leaves out rows with nothing for the measure", () => {
    expect(topRows(rows, "paid", 10, "Other").some((r) => r.name === "A")).toBe(false);
  });

  it("adds up the rest into one row past the limit", () => {
    const top = topRows(rows, "count", 3, "All other");
    expect(top).toEqual([
      rows[1],
      rows[2],
      { name: "All other", count: 3, incurred: 500, paid: 0 },
    ]);
  });

  it("breaks ties by name so the order is stable", () => {
    const tied: BreakdownRow[] = [
      { name: "Zeta", count: 1, incurred: 0, paid: 0 },
      { name: "Alpha", count: 1, incurred: 0, paid: 0 },
    ];
    expect(topRows(tied, "count", 10, "Other").map((r) => r.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("does not change the input", () => {
    const copy = structuredClone(rows);
    topRows(rows, "incurred", 2, "Other");
    expect(rows).toEqual(copy);
  });
});

describe("largestOpenClaims", () => {
  it("ranks open and reopened claims by incurred", () => {
    const big = claim({ paid_amount: 1000, reserve_amount: 4000 });
    const mid = claim({ status: CLAIM_STATUS.reopened, reserve_amount: 3000 });
    const small = claim({ paid_amount: 100 });
    const closed = claim({ status: CLAIM_STATUS.closed, paid_amount: 99999 });
    const submitted = claim({ status: CLAIM_STATUS.submitted, reserve_amount: 99999 });
    const notice = claim({ status: CLAIM_STATUS.notice, reserve_amount: 99999 });
    expect(largestOpenClaims([small, closed, mid, submitted, big, notice], "count")).toEqual([
      big,
      mid,
      small,
    ]);
  });

  it("ranks by paid when the page shows paid", () => {
    const highReserve = claim({ paid_amount: 10, reserve_amount: 9000 });
    const highPaid = claim({ paid_amount: 500, reserve_amount: 0 });
    expect(largestOpenClaims([highReserve, highPaid], "paid")).toEqual([highPaid, highReserve]);
    expect(largestOpenClaims([highReserve, highPaid], "incurred")).toEqual([highReserve, highPaid]);
  });

  it("leaves out claims with no amount yet", () => {
    expect(
      largestOpenClaims([claim(), claim({ paid_amount: null, reserve_amount: null })], "count"),
    ).toEqual([]);
    const reserveOnly = claim({ reserve_amount: 10 });
    expect(largestOpenClaims([reserveOnly], "paid")).toEqual([]);
  });

  it("keeps at most the limit", () => {
    const claims = Array.from({ length: 15 }, (_, i) => claim({ paid_amount: i + 1 }));
    const top = largestOpenClaims(claims, "incurred");
    expect(top).toHaveLength(10);
    expect(top[0].paid_amount).toBe(15);
    expect(top[9].paid_amount).toBe(6);
    expect(largestOpenClaims(claims, "incurred", 3)).toHaveLength(3);
  });

  it("breaks ties by claim number", () => {
    const b = claim({ claim_number: "B-2", paid_amount: 10 });
    const a = claim({ claim_number: "A-1", paid_amount: 10 });
    expect(largestOpenClaims([b, a], "incurred")).toEqual([a, b]);
  });
});

describe("largestClaimsMeasure", () => {
  it("uses incurred unless the page shows paid", () => {
    expect(largestClaimsMeasure("count")).toBe("incurred");
    expect(largestClaimsMeasure("incurred")).toBe("incurred");
    expect(largestClaimsMeasure("paid")).toBe("paid");
  });
});
