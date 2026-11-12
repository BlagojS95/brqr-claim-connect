import { describe, expect, it } from "vitest";
import {
  CLAIMS_PAGE_SIZE,
  activeFilterCount,
  claimFilterOptions,
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
  claimant_name: null,
  employee_name: null,
  driver_name: null,
  vehicles_involved: null,
  loss_location: null,
  location_name: null,
  cause_of_loss: null,
  policy_number: null,
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

  it("keeps the line, year, carrier and location filters (fix 31)", () => {
    expect(
      parseClaimsSearch({
        line: "Business Auto",
        year: 2025,
        carrier: "Progressive",
        location: "Dayton Yard",
      }),
    ).toEqual({
      line: "Business Auto",
      year: 2025,
      carrier: "Progressive",
      location: "Dayton Yard",
    });
  });

  it("trims filter text and accepts the year as text", () => {
    expect(parseClaimsSearch({ carrier: "  Chubb ", location: " HQ ", year: "2026" })).toEqual({
      carrier: "Chubb",
      location: "HQ",
      year: 2026,
    });
  });

  it("drops malformed filters", () => {
    expect(
      parseClaimsSearch({
        line: "   ",
        year: "26",
        carrier: 42,
        location: ["HQ"],
      }),
    ).toEqual({});
    for (const year of [1899, 2101, 2025.5, "2025abc", "", null, "abcd"]) {
      expect(parseClaimsSearch({ year })).toEqual({});
    }
    expect(parseClaimsSearch({ carrier: "x".repeat(201) })).toEqual({});
    expect(parseClaimsSearch({ q: "x".repeat(201) })).toEqual({});
    expect(parseClaimsSearch({ hack: "1" })).toEqual({});
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

describe("filterClaims search (fix 31)", () => {
  const claims = [
    claim({
      id: "wc",
      line_of_business: "Workers Compensation",
      claimant_name: "Maria Gomez",
      employee_name: "Maria Gomez",
      loss_location: "Warehouse 3, Dayton OH",
      description: "Back strain lifting boxes",
    }),
    claim({
      id: "auto",
      line_of_business: "Business Auto",
      carrier: "Progressive",
      driver_name: "John Smith",
      vehicles_involved: "Unit 42 - 2021 Ford F-150",
      loss_location: "I-75 near Dayton",
    }),
    claim({
      id: "gl",
      claimant_name: "Ann Lee",
      adjuster_name: "Pat Lee",
      loss_location: "Main St store",
    }),
  ];
  const ids = (q: string) => filterClaims(claims, { q }).map((c) => c.id);

  it("matches the claimant, employee, driver, vehicle and loss location", () => {
    expect(ids("gomez")).toEqual(["wc"]);
    expect(ids("smith")).toEqual(["auto"]);
    expect(ids("unit 42")).toEqual(["auto"]);
    expect(ids("F-150")).toEqual(["auto"]);
    expect(ids("warehouse")).toEqual(["wc"]);
    expect(ids("dayton")).toEqual(["wc", "auto"]);
    expect(ids("strain")).toEqual(["wc"]);
  });

  it("needs every word, each possibly in a different field", () => {
    expect(ids("dayton smith")).toEqual(["auto"]);
    expect(ids("progressive unit")).toEqual(["auto"]);
    expect(ids("lee store")).toEqual(["gl"]);
    expect(ids("gomez smith")).toEqual([]);
  });

  it("ignores case and extra whitespace", () => {
    expect(ids("  JOHN   smith ")).toEqual(["auto"]);
    expect(ids("\tmaria\n gomez")).toEqual(["wc"]);
    expect(ids("   ")).toEqual(["wc", "auto", "gl"]);
  });

  it("does not match a word across two fields", () => {
    // "Gomez" ends the claimant and "Warehouse" starts the location.
    expect(ids("gomezwarehouse")).toEqual([]);
  });

  it("still matches claim number, type, carrier and adjuster", () => {
    const rows = [
      claim({ id: "x", claim_number: "PRG-77", claim_type: "Collision", adjuster_name: "Kim Ng" }),
    ];
    for (const q of ["prg-77", "collision", "kim ng"]) {
      expect(filterClaims(rows, { q }).map((c) => c.id)).toEqual(["x"]);
    }
  });
});

describe("filterClaims filters (fix 31)", () => {
  const claims = [
    claim({
      id: "a",
      line_of_business: "Business Auto",
      date_of_loss: "2025-12-31",
      carrier: "Progressive",
      loss_location: "Dayton Yard",
    }),
    claim({
      id: "b",
      line_of_business: "General Liability",
      date_of_loss: "2026-01-01",
      carrier: "Chubb",
      loss_location: " dayton yard ",
    }),
    claim({
      id: "c",
      line_of_business: "Business Auto",
      date_of_loss: "2026-06-15",
      carrier: "progressive ",
      loss_location: "Columbus",
    }),
    claim({ id: "d", date_of_loss: null, carrier: null, loss_location: null }),
  ];
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it("filters by line of business", () => {
    expect(ids(filterClaims(claims, { line: "Business Auto" }))).toEqual(["a", "c"]);
    expect(ids(filterClaims(claims, { line: "business auto" }))).toEqual(["a", "c"]);
  });

  it("filters by the calendar year of the loss, with no time zone shift", () => {
    expect(ids(filterClaims(claims, { year: 2025 }))).toEqual(["a"]);
    expect(ids(filterClaims(claims, { year: 2026 }))).toEqual(["b", "c"]);
    expect(filterClaims(claims, { year: 2024 })).toEqual([]);
  });

  it("filters by carrier, ignoring case and outer spaces", () => {
    expect(ids(filterClaims(claims, { carrier: "Progressive" }))).toEqual(["a", "c"]);
    expect(ids(filterClaims(claims, { carrier: "CHUBB" }))).toEqual(["b"]);
  });

  it("filters by location, trimmed and ignoring case", () => {
    expect(ids(filterClaims(claims, { location: "Dayton Yard" }))).toEqual(["a", "b"]);
    expect(ids(filterClaims(claims, { location: "columbus" }))).toEqual(["c"]);
  });

  it("filters by the client's site before the loss location text (fix 32)", () => {
    const sited = [
      claim({ id: "s1", location_name: "North Plant", loss_location: "Dock 2" }),
      claim({ id: "s2", location_name: null, loss_location: "Dock 2" }),
    ];
    expect(ids(filterClaims(sited, { location: "north plant" }))).toEqual(["s1"]);
    expect(ids(filterClaims(sited, { location: "Dock 2" }))).toEqual(["s2"]);
    expect(claimFilterOptions(sited).locations).toEqual(["Dock 2", "North Plant"]);
    expect(ids(filterClaims(sited, { q: "plant" }))).toEqual(["s1"]);
  });

  it("combines filters with status and search", () => {
    expect(ids(filterClaims(claims, { line: "Business Auto", year: 2026 }))).toEqual(["c"]);
    expect(
      ids(filterClaims(claims, { carrier: "progressive", location: "dayton yard", q: "auto" })),
    ).toEqual(["a"]);
    expect(filterClaims(claims, { carrier: "progressive", status: CLAIM_STATUS.closed })).toEqual(
      [],
    );
  });
});

describe("activeFilterCount", () => {
  it("counts the line, year, carrier and location filters only", () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ line: "Cyber", year: 2026 })).toBe(2);
    expect(
      activeFilterCount({
        line: "Cyber",
        year: 2026,
        carrier: "Chubb",
        location: "HQ",
        status: CLAIM_STATUS.open,
        q: "x",
      } as Parameters<typeof activeFilterCount>[0]),
    ).toBe(4);
  });
});

describe("claimFilterOptions", () => {
  it("lists distinct values, sorted, years newest first", () => {
    const options = claimFilterOptions([
      claim({ id: "1", carrier: "Zurich", date_of_loss: "2024-05-01", loss_location: "HQ" }),
      claim({ id: "2", carrier: " chubb", date_of_loss: "2026-01-01", loss_location: "hq " }),
      claim({ id: "3", carrier: "Chubb", date_of_loss: "2024-12-31", loss_location: "" }),
      claim({
        id: "4",
        carrier: null,
        date_of_loss: null,
        line_of_business: "Business Auto",
        loss_location: null,
      }),
    ]);
    expect(options.carriers).toEqual(["chubb", "Zurich"]);
    expect(options.years).toEqual([2026, 2024]);
    expect(options.locations).toEqual(["HQ"]);
    expect(options.lines).toEqual(["Business Auto", "General Liability"]);
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

describe("Insights click-through filters (fix 45)", () => {
  const claims = [
    {
      ...base,
      claim_number: "A",
      cause_of_loss: "Fire",
      policy_number: "GL 1001",
      date_of_loss: "2026-03-15",
    },
    {
      ...base,
      claim_number: "B",
      cause_of_loss: "fire ",
      policy_number: "gl1001",
      date_of_loss: "2025-03-15",
    },
    {
      ...base,
      claim_number: "C",
      cause_of_loss: "Theft",
      policy_number: "AU-9",
      date_of_loss: null,
    },
  ];
  const numbers = (search: Parameters<typeof filterClaims>[1]) =>
    filterClaims(claims, search).map((c) => c.claim_number);

  it("parses cause, policy and a real date range, dropping bad dates", () => {
    expect(
      parseClaimsSearch({
        cause: " Fire ",
        policy: "GL 1001",
        from: "2026-01-01",
        to: "2026-02-30",
      }),
    ).toEqual({ cause: "Fire", policy: "GL 1001", from: "2026-01-01" });
  });

  it("filters by cause ignoring case and by policy ignoring spaces", () => {
    expect(numbers({ cause: "FIRE" })).toEqual(["A", "B"]);
    expect(numbers({ policy: "GL1001" })).toEqual(["A", "B"]);
  });

  it("keeps claims whose date of loss is in the range, both ends included", () => {
    expect(numbers({ from: "2026-03-15", to: "2026-03-15" })).toEqual(["A"]);
    expect(numbers({ from: "2025-01-01" })).toEqual(["A", "B"]);
    expect(numbers({ to: "2025-12-31" })).toEqual(["B"]);
  });
});
