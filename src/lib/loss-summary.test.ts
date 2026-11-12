import { describe, expect, it } from "vitest";
import { CLAIM_STATUS } from "@/lib/claim-status";
import { totalIncurred, totalPaid } from "@/lib/claim-metrics";
import {
  buildLossSummary,
  filterLossSummary,
  lossSummaryExportTable,
  lossSummaryFilterLabel,
  lossSummaryOptions,
  nextLossSummarySort,
  sumTotals,
  type LossSummaryClaim,
} from "@/lib/loss-summary";

const claim = (fields: Partial<LossSummaryClaim> & { id: string }): LossSummaryClaim => ({
  claim_number: null,
  status: CLAIM_STATUS.open,
  line_of_business: "General Liability",
  carrier: "Chubb",
  date_of_loss: "2026-03-01",
  paid_amount: null,
  reserve_amount: null,
  ...fields,
});

const CLAIMS = [
  claim({ id: "a", claim_number: "A-1", paid_amount: 100, reserve_amount: 50 }),
  claim({
    id: "b",
    claim_number: "B-1",
    date_of_loss: "2026-06-01",
    paid_amount: 300,
    status: CLAIM_STATUS.closed,
  }),
  claim({ id: "c", line_of_business: "Business Auto", carrier: "Travelers", reserve_amount: 1000 }),
  claim({ id: "d", date_of_loss: "2025-12-31", paid_amount: 20, reserve_amount: 5 }),
  claim({
    id: "e",
    line_of_business: "Business Auto",
    carrier: null,
    date_of_loss: null,
    paid_amount: 7,
  }),
];

describe("buildLossSummary", () => {
  const summary = buildLossSummary(CLAIMS);

  it("groups newest year first, lines A to Z, 'No date' last", () => {
    expect(summary.years.map((y) => [y.year, y.lines.map((l) => l.line)])).toEqual([
      [2026, ["Business Auto", "General Liability"]],
      [2025, ["General Liability"]],
      [0, ["Business Auto"]],
    ]);
  });

  it("sorts claims newest loss first within a line by default", () => {
    const gl2026 = summary.years[0].lines[1];
    expect(gl2026.rows.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("subtotals equal the sum of their claims, and the grand total the sum of everything", () => {
    for (const y of summary.years) {
      for (const l of y.lines) expect(l.totals).toEqual(sumTotals(l.rows));
      expect(y.totals).toEqual(sumTotals(y.lines.flatMap((l) => l.rows)));
    }
    expect(summary.totals.claims).toBe(CLAIMS.length);
    expect(summary.totals.paid).toBe(totalPaid(CLAIMS));
    expect(summary.totals.incurred).toBe(totalIncurred(CLAIMS));
    expect(summary.totals.incurred).toBe(summary.totals.paid + summary.totals.reserve);
    expect(summary.years.reduce((s, y) => s + y.totals.incurred, 0)).toBe(summary.totals.incurred);
  });

  it("sorting on Year or Line reorders the groups", () => {
    const asc = buildLossSummary(CLAIMS, { key: "year", dir: "asc" });
    expect(asc.years.map((y) => y.year)).toEqual([2025, 2026, 0]);
    const linesDesc = buildLossSummary(CLAIMS, { key: "line", dir: "desc" });
    expect(linesDesc.years[0].lines.map((l) => l.line)).toEqual([
      "General Liability",
      "Business Auto",
    ]);
  });

  it("sorting on another column sorts claims inside each line, totals unchanged", () => {
    const byPaid = buildLossSummary(CLAIMS, { key: "paid", dir: "asc" });
    expect(byPaid.years[0].lines[1].rows.map((c) => c.id)).toEqual(["a", "b"]);
    expect(byPaid.totals).toEqual(summary.totals);
  });
});

describe("filterLossSummary", () => {
  it("filters by year, line and carrier ignoring case", () => {
    expect(filterLossSummary(CLAIMS, { year: 2026 }).map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(filterLossSummary(CLAIMS, { line: "business auto" }).map((c) => c.id)).toEqual([
      "c",
      "e",
    ]);
    expect(filterLossSummary(CLAIMS, { carrier: "CHUBB", year: 2025 }).map((c) => c.id)).toEqual([
      "d",
    ]);
    expect(filterLossSummary(CLAIMS, { year: 0 }).map((c) => c.id)).toEqual(["e"]);
    expect(filterLossSummary(CLAIMS, { carrier: "—" }).map((c) => c.id)).toEqual(["e"]);
  });

  it("offers the years, lines and carriers that are there", () => {
    expect(lossSummaryOptions(CLAIMS)).toEqual({
      years: [2026, 2025, 0],
      lines: ["Business Auto", "General Liability"],
      carriers: ["—", "Chubb", "Travelers"],
    });
  });
});

describe("lossSummaryExportTable", () => {
  it("carries every claim, a subtotal per line and year, and the grand total", () => {
    const table = lossSummaryExportTable(buildLossSummary(CLAIMS));
    // 5 claims + 4 line subtotals + 3 year subtotals
    expect(table.rows).toHaveLength(12);
    expect(table.emphasis).toHaveLength(7);
    for (const i of table.emphasis) expect(String(table.rows[i][0])).toMatch(/subtotal$/);
    expect(table.totals?.slice(-3)).toEqual([427, 1055, 1482]);
  });
});

describe("lossSummaryFilterLabel and sorting", () => {
  it("describes the filters", () => {
    expect(lossSummaryFilterLabel({})).toBe("All years, lines and carriers");
    expect(lossSummaryFilterLabel({ year: 2026, line: "Business Auto" })).toBe(
      "Year 2026 · Business Auto",
    );
  });

  it("flips the same column and starts a new one at its default", () => {
    expect(nextLossSummarySort({ key: "year", dir: "desc" }, "year")).toEqual({
      key: "year",
      dir: "asc",
    });
    expect(nextLossSummarySort({ key: "year", dir: "desc" }, "carrier")).toEqual({
      key: "carrier",
      dir: "asc",
    });
    expect(nextLossSummarySort({ key: "year", dir: "desc" }, "paid")).toEqual({
      key: "paid",
      dir: "desc",
    });
  });
});
