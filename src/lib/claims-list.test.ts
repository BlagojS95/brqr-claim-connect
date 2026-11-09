import { describe, expect, it } from "vitest";
import {
  CLAIMS_PAGE_SIZE,
  defaultSortDir,
  filterClaims,
  nextSort,
  pageRangeLabel,
  paginate,
  parseClaimsSearch,
  sortClaims,
  type ClaimListItem,
} from "@/lib/claims-list";
import { CLAIM_STATUS } from "@/lib/claim-status";
import { WAITING_ON } from "@/lib/waiting-on";

const base: ClaimListItem = {
  claim_number: null,
  claim_type: "General Liability",
  line_of_business: "General Liability",
  carrier: null,
  adjuster_name: null,
  description: null,
  status: CLAIM_STATUS.open,
  date_of_loss: null,
  closed_date: null,
  paid_amount: null,
  reserve_amount: null,
  waiting_on: null,
  last_activity_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

const claim = (fields: Partial<ClaimListItem> & { id: string }) => ({ ...base, ...fields });

describe("parseClaimsSearch", () => {
  it("keeps valid values", () => {
    expect(
      parseClaimsSearch({ status: "open", q: "chubb", sort: "paid", dir: "asc", page: 3 }),
    ).toEqual({ status: "open", q: "chubb", sort: "paid", dir: "asc", page: 3 });
    expect(parseClaimsSearch({ sort: "waiting" })).toEqual({ sort: "waiting" });
    expect(parseClaimsSearch({ sort: "updated" })).toEqual({ sort: "updated" });
  });

  it("accepts the page as text", () => {
    expect(parseClaimsSearch({ page: "2" })).toEqual({ page: 2 });
  });

  it("drops unknown or malformed values", () => {
    expect(
      parseClaimsSearch({ status: "Open", q: "  ", sort: "hack", dir: "up", page: "x" }),
    ).toEqual({});
    expect(parseClaimsSearch({ page: 1 })).toEqual({});
    expect(parseClaimsSearch({ page: -4 })).toEqual({});
    expect(parseClaimsSearch({ page: 2.5 })).toEqual({});
  });

  it("accepts every claim status", () => {
    for (const status of Object.values(CLAIM_STATUS)) {
      expect(parseClaimsSearch({ status }).status).toBe(status);
    }
  });
});

describe("filterClaims", () => {
  const claims = [
    claim({ id: "a", status: CLAIM_STATUS.open, carrier: "Chubb Indemnity" }),
    claim({ id: "b", status: CLAIM_STATUS.closed, claim_number: "TR-123" }),
    claim({ id: "c", status: CLAIM_STATUS.reopened, adjuster_name: "Pat Lee" }),
  ];

  it("returns everything without filters", () => {
    expect(filterClaims(claims, {}).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("filters by status", () => {
    expect(filterClaims(claims, { status: CLAIM_STATUS.open }).map((c) => c.id)).toEqual([
      "a",
      "c",
    ]);
    expect(filterClaims(claims, { status: CLAIM_STATUS.closed }).map((c) => c.id)).toEqual(["b"]);
  });

  it("searches text fields case-insensitively", () => {
    expect(filterClaims(claims, { q: "CHUBB" }).map((c) => c.id)).toEqual(["a"]);
    expect(filterClaims(claims, { q: "tr-1" }).map((c) => c.id)).toEqual(["b"]);
    expect(filterClaims(claims, { q: "pat" }).map((c) => c.id)).toEqual(["c"]);
    expect(filterClaims(claims, { q: "reopened" }).map((c) => c.id)).toEqual(["c"]);
  });

  it("combines status and search", () => {
    expect(filterClaims(claims, { status: CLAIM_STATUS.closed, q: "pat" })).toEqual([]);
    expect(filterClaims(claims, { status: CLAIM_STATUS.open, q: "pat" }).map((c) => c.id)).toEqual([
      "c",
    ]);
  });
});

describe("sortClaims", () => {
  const claims = [
    claim({ id: "a", date_of_loss: "2026-03-01", paid_amount: 100, carrier: "travelers" }),
    claim({ id: "b", date_of_loss: null, paid_amount: null, carrier: null }),
    claim({ id: "c", date_of_loss: "2025-12-31", paid_amount: 2500, carrier: "Chubb" }),
    claim({ id: "d", date_of_loss: "2026-10-09", paid_amount: 100, carrier: "Zurich" }),
  ];
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it("sorts dates as calendar text, missing last both ways", () => {
    expect(ids(sortClaims(claims, "date", "desc"))).toEqual(["d", "a", "c", "b"]);
    expect(ids(sortClaims(claims, "date", "asc"))).toEqual(["c", "a", "d", "b"]);
  });

  it("sorts money numerically and keeps ties in their original order", () => {
    expect(ids(sortClaims(claims, "paid", "desc"))).toEqual(["c", "a", "d", "b"]);
    expect(ids(sortClaims(claims, "paid", "asc"))).toEqual(["b", "a", "d", "c"]);
  });

  it("sorts text ignoring case, missing last", () => {
    expect(ids(sortClaims(claims, "carrier", "asc"))).toEqual(["c", "a", "d", "b"]);
    expect(ids(sortClaims(claims, "carrier", "desc"))).toEqual(["d", "a", "c", "b"]);
  });

  it("sorts status in display order", () => {
    const rows = [
      claim({ id: "closed", status: CLAIM_STATUS.closed }),
      claim({ id: "notice", status: CLAIM_STATUS.notice }),
      claim({ id: "open", status: CLAIM_STATUS.open }),
    ];
    expect(ids(sortClaims(rows, "status", "asc"))).toEqual(["notice", "open", "closed"]);
  });

  it("sorts waiting on as Client, Agency, Carrier with closed claims last", () => {
    const rows = [
      claim({ id: "carrier", waiting_on: WAITING_ON.carrier }),
      claim({ id: "closed", status: CLAIM_STATUS.closed, waiting_on: WAITING_ON.client }),
      claim({ id: "client", waiting_on: WAITING_ON.client }),
      claim({ id: "agency", waiting_on: WAITING_ON.agency }),
    ];
    expect(ids(sortClaims(rows, "waiting", "asc"))).toEqual([
      "client",
      "agency",
      "carrier",
      "closed",
    ]);
    expect(ids(sortClaims(rows, "waiting", "desc"))).toEqual([
      "carrier",
      "agency",
      "client",
      "closed",
    ]);
  });

  it("sorts days since update, stalest first by default, falling back to created_at", () => {
    const rows = [
      claim({ id: "recent", last_activity_at: "2026-11-08T12:00:00Z" }),
      claim({ id: "stale", last_activity_at: "2026-09-01T12:00:00Z" }),
      claim({ id: "never", last_activity_at: null, created_at: "2026-10-01T00:00:00Z" }),
    ];
    expect(defaultSortDir("updated")).toBe("desc");
    expect(ids(sortClaims(rows, "updated", "desc"))).toEqual(["stale", "never", "recent"]);
    expect(ids(sortClaims(rows, "updated", "asc"))).toEqual(["recent", "never", "stale"]);
  });

  it("does not change the input", () => {
    const copy = [...claims];
    sortClaims(claims, "paid", "asc");
    expect(claims).toEqual(copy);
  });
});

describe("paginate", () => {
  const rows = Array.from({ length: 60 }, (_, i) => i + 1);

  it("pages by 25", () => {
    expect(CLAIMS_PAGE_SIZE).toBe(25);
    const first = paginate(rows, 1);
    expect(first).toMatchObject({ page: 1, pageCount: 3, total: 60, from: 1, to: 25 });
    expect(first.rows).toHaveLength(25);
    const last = paginate(rows, 3);
    expect(last).toMatchObject({ page: 3, from: 51, to: 60 });
    expect(last.rows).toEqual(rows.slice(50));
  });

  it("clamps pages out of range", () => {
    expect(paginate(rows, 9).page).toBe(3);
    expect(paginate(rows, 0).page).toBe(1);
  });

  it("handles an empty list", () => {
    expect(paginate([], 1)).toMatchObject({ rows: [], page: 1, pageCount: 1, from: 0, to: 0 });
  });

  it("labels the range", () => {
    expect(pageRangeLabel(paginate(rows, 2))).toBe("26–50 of 60");
    expect(pageRangeLabel(paginate([], 1))).toBe("0 of 0");
  });
});

describe("nextSort", () => {
  it("flips the direction on the same column", () => {
    expect(nextSort({ sort: "paid", dir: "desc" }, "paid")).toEqual({ sort: "paid", dir: "asc" });
    expect(nextSort({ sort: "paid", dir: "asc" }, "paid")).toEqual({ sort: "paid", dir: "desc" });
  });

  it("starts a new column at its natural direction", () => {
    expect(nextSort({ sort: "date", dir: "desc" }, "carrier")).toEqual({
      sort: "carrier",
      dir: "asc",
    });
    expect(nextSort({ sort: "carrier", dir: "asc" }, "reserve")).toEqual({
      sort: "reserve",
      dir: "desc",
    });
    expect(nextSort({ sort: "date", dir: "desc" }, "waiting")).toEqual({
      sort: "waiting",
      dir: "asc",
    });
    expect(nextSort({ sort: "date", dir: "desc" }, "updated")).toEqual({
      sort: "updated",
      dir: "desc",
    });
  });
});

describe("status=open", () => {
  it("includes reopened claims, matching the Open Claims count on Home", () => {
    const rows = [
      claim({ id: "o", status: CLAIM_STATUS.open }),
      claim({ id: "r", status: CLAIM_STATUS.reopened }),
      claim({ id: "c", status: CLAIM_STATUS.closed }),
    ];
    expect(filterClaims(rows, { status: CLAIM_STATUS.open }).map((c) => c.id)).toEqual(["o", "r"]);
    expect(filterClaims(rows, { status: CLAIM_STATUS.reopened }).map((c) => c.id)).toEqual(["r"]);
  });
});
