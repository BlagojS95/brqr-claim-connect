import { describe, expect, it } from "vitest";
import { CLAIM_STATUS } from "@/lib/claim-status";
import { totalIncurred, totalPaid } from "@/lib/claim-metrics";
import {
  groupLossSummary,
  lossRunDetailTable,
  lossRunGroupTable,
  lossSummaryTable,
  statusCountsLabel,
  type LossSummaryClaim,
} from "@/lib/exports/loss-summary-export";

const claim = (fields: Partial<LossSummaryClaim> & { id: string }): LossSummaryClaim => ({
  claim_number: null,
  status: CLAIM_STATUS.open,
  line_of_business: "General Liability",
  carrier: "Chubb",
  date_of_loss: "2026-01-01",
  claimant_name: null,
  paid_amount: null,
  reserve_amount: null,
  ...fields,
});

const claims = [
  claim({ id: "a", paid_amount: 100, reserve_amount: 50 }),
  claim({ id: "b", status: CLAIM_STATUS.closed, paid_amount: 300 }),
  claim({ id: "c", date_of_loss: "2025-12-31", reserve_amount: 1000 }),
  claim({ id: "d", line_of_business: "Business Auto", carrier: null, date_of_loss: null }),
];

describe("groupLossSummary", () => {
  it("groups by calendar year, line and carrier, newest year first", () => {
    const groups = groupLossSummary(claims);
    expect(groups.map((g) => [g.year, g.lob, g.carrier, g.rows.length])).toEqual([
      [2026, "General Liability", "Chubb", 2],
      [2025, "General Liability", "Chubb", 1],
      [0, "Business Auto", "—", 1],
    ]);
  });

  it("filters on year, 'no date', line or carrier text", () => {
    expect(groupLossSummary(claims, "2025")).toHaveLength(1);
    expect(groupLossSummary(claims, "No Date")[0].lob).toBe("Business Auto");
    expect(groupLossSummary(claims, "liab")).toHaveLength(2);
  });
});

describe("loss summary tables", () => {
  const groups = groupLossSummary(claims);

  it("summary rows carry each group's totals and a grand total that matches claim-metrics", () => {
    const table = lossSummaryTable(groups);
    expect(table.rows[0]).toEqual([
      "2026",
      "General Liability",
      "Chubb",
      "2",
      "1 Open · 1 Closed",
      400,
      450,
    ]);
    expect(table.totals).toEqual([
      "Total",
      null,
      null,
      "4",
      statusCountsLabel(claims),
      totalPaid(claims),
      totalIncurred(claims),
    ]);
    expect(table.totals?.[6]).toBe(1450);
  });

  it("a group's table lists its claims with a totals row", () => {
    const table = lossRunGroupTable(groups[0]);
    expect(table.rows.map((r) => r[0])).toEqual(["Number pending", "Number pending"]);
    expect(table.totals).toEqual(["Total (2)", null, null, "1 Open · 1 Closed", 400, 50, 450]);
  });

  it("the detail sheet has every claim and the same grand total", () => {
    const table = lossRunDetailTable(groups);
    expect(table.rows).toHaveLength(4);
    expect(table.rows[2].slice(0, 5)).toEqual([
      "2025",
      "General Liability",
      "Chubb",
      "Number pending",
      "12/31/2025",
    ]);
    expect(table.totals?.at(-1)).toBe(totalIncurred(claims));
    expect(table.totals?.at(-3)).toBe(totalPaid(claims));
  });
});
