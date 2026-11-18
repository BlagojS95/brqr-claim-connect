import { describe, expect, it } from "vitest";
import { CLAIM_STATUS } from "@/lib/claim-status";
import { WAITING_ON } from "@/lib/waiting-on";
import {
  QuickEditSchema,
  claimUpdateActivityBody,
  diffClaimValues,
  formatMoney,
  fromDateTimeLocal,
  toDateTimeLocal,
  type ClaimEditableValues,
} from "@/lib/claim-quick-edit";

const JANE = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-16T15:05:00Z");

const base: ClaimEditableValues = {
  claim_number: null,
  adjuster_name: null,
  adjuster_phone: null,
  adjuster_email: null,
  status: CLAIM_STATUS.submitted,
  paid_amount: 0,
  reserve_amount: 0,
  waiting_on: WAITING_ON.agency,
  assigned_to: null,
  submitted_to_carrier_at: null,
  first_carrier_contact_at: null,
  closed_date: null,
};

const staffName = (id: string | null) =>
  id === JANE ? "Jane" : id ? "Former staff member" : "Unassigned";

describe("diffClaimValues", () => {
  it("returns nothing when nothing changed", () => {
    const { update, changes } = diffClaimValues(base, { ...base }, { now: NOW, staffName });
    expect(update).toEqual({});
    expect(changes).toEqual([]);
  });

  it("writes only the fields that changed and describes them old -> new", () => {
    const { update, changes } = diffClaimValues(
      {
        ...base,
        submitted_to_carrier_at: "2026-11-10T14:00:00Z",
        first_carrier_contact_at: "2026-11-11T14:00:00Z",
      },
      {
        ...base,
        submitted_to_carrier_at: "2026-11-10T14:00:00Z",
        first_carrier_contact_at: "2026-11-11T14:00:00Z",
        claim_number: "TRV-123",
        reserve_amount: 5000,
        assigned_to: JANE,
      },
      { now: NOW, staffName },
    );
    expect(update).toEqual({ claim_number: "TRV-123", reserve_amount: 5000, assigned_to: JANE });
    expect(claimUpdateActivityBody(changes)).toBe(
      "Carrier claim # changed from — to TRV-123; Reserve changed from $0 to $5,000; Assigned to changed from Unassigned to Jane",
    );
  });

  it("treats blank text and null as the same, and clears to null", () => {
    expect(
      diffClaimValues({ ...base, adjuster_name: "" }, { adjuster_name: null }).changes,
    ).toEqual([]);
    const { update } = diffClaimValues(
      { ...base, adjuster_phone: "555-1234" },
      { adjuster_phone: "" },
    );
    expect(update).toEqual({ adjuster_phone: null });
  });

  it("ignores seconds on timestamps (the input only has minutes)", () => {
    const current = { ...base, submitted_to_carrier_at: "2026-11-10T14:00:37.123+00:00" };
    expect(
      diffClaimValues(current, { submitted_to_carrier_at: "2026-11-10T14:00:00.000Z" }).changes,
    ).toEqual([]);
  });

  it("compares money to the cent", () => {
    expect(
      diffClaimValues({ ...base, paid_amount: 1234.5 }, { paid_amount: 1234.5 }).changes,
    ).toEqual([]);
    const { changes } = diffClaimValues({ ...base, paid_amount: 1234.5 }, { paid_amount: 1234.51 });
    expect(changes[0]).toMatchObject({ from: "$1,234.50", to: "$1,234.51" });
  });

  it("writes a status change but leaves its log line to the trigger", () => {
    const { update, changes } = diffClaimValues(base, { status: CLAIM_STATUS.open });
    expect(update).toEqual({ status: CLAIM_STATUS.open });
    expect(changes).toHaveLength(1);
    expect(claimUpdateActivityBody(changes)).toBeNull();
  });

  it("only looks at the fields given", () => {
    const { update } = diffClaimValues({ ...base, adjuster_name: "Ann" }, { paid_amount: 10 });
    expect(update).toEqual({ paid_amount: 10 });
  });

  it("labels waiting on, dates and closed date for people", () => {
    const { changes } = diffClaimValues(base, {
      waiting_on: WAITING_ON.carrier,
      closed_date: "2026-03-05",
    });
    expect(changes.map((c) => `${c.label}: ${c.from} -> ${c.to}`)).toEqual([
      "Closed date: — -> 3/5/2026",
      "Waiting on: Agency -> Carrier",
    ]);
  });
});

describe("quick edit timestamp rules", () => {
  it("sets submitted_to_carrier_at when a carrier claim number is first entered", () => {
    const { update, changes } = diffClaimValues(
      base,
      { ...base, claim_number: "TRV-1" },
      { now: NOW },
    );
    expect(update.submitted_to_carrier_at).toBe(NOW.toISOString());
    expect(changes.find((c) => c.field === "submitted_to_carrier_at")?.automatic).toBe(true);
    expect(claimUpdateActivityBody(changes)).toContain(
      "Submitted to carrier changed from — to 11/16/2026, 10:05 AM ET (set automatically)",
    );
  });

  it("keeps the time staff typed instead", () => {
    const typed = "2026-11-12T13:00:00.000Z";
    const { update } = diffClaimValues(
      base,
      { ...base, claim_number: "TRV-1", submitted_to_carrier_at: typed },
      { now: NOW },
    );
    expect(update.submitted_to_carrier_at).toBe(typed);
  });

  it("doesn't touch it when the claim already had a number or a time", () => {
    expect(
      diffClaimValues(
        { ...base, claim_number: "OLD" },
        { ...base, claim_number: "NEW" },
        { now: NOW },
      ).update.submitted_to_carrier_at,
    ).toBeUndefined();
    const stamped = { ...base, submitted_to_carrier_at: "2026-11-01T12:00:00Z" };
    expect(
      diffClaimValues(stamped, { ...stamped, claim_number: "TRV-1" }, { now: NOW }).update
        .submitted_to_carrier_at,
    ).toBeUndefined();
  });

  it("sets first_carrier_contact_at when an adjuster is first entered", () => {
    for (const field of ["adjuster_name", "adjuster_phone", "adjuster_email"] as const) {
      const { update } = diffClaimValues(base, { ...base, [field]: "x" }, { now: NOW });
      expect(update.first_carrier_contact_at).toBe(NOW.toISOString());
    }
  });

  it("doesn't set first contact when an adjuster was already there", () => {
    const current = { ...base, adjuster_name: "Ann" };
    const { update } = diffClaimValues(
      current,
      { ...current, adjuster_email: "ann@carrier.com" },
      { now: NOW },
    );
    expect(update.first_carrier_contact_at).toBeUndefined();
  });

  it("only applies with `now` (the import passes none)", () => {
    expect(diffClaimValues(base, { claim_number: "TRV-1", adjuster_name: "Ann" }).update).toEqual({
      claim_number: "TRV-1",
      adjuster_name: "Ann",
    });
  });
});

describe("QuickEditSchema", () => {
  const input = {
    claimId: "22222222-2222-4222-8222-222222222222",
    claim_number: "  TRV-1 ",
    adjuster_name: "",
    adjuster_phone: null,
    adjuster_email: "",
    status: CLAIM_STATUS.open,
    paid_amount: 0,
    reserve_amount: null,
    waiting_on: null,
    assigned_to: null,
    submitted_to_carrier_at: null,
    first_carrier_contact_at: "2026-11-16T15:05:00.000Z",
  };

  it("trims text and turns blanks into null", () => {
    const parsed = QuickEditSchema.parse(input);
    expect(parsed.claim_number).toBe("TRV-1");
    expect(parsed.adjuster_name).toBeNull();
    expect(parsed.adjuster_email).toBeNull();
  });

  it("rejects bad values", () => {
    expect(QuickEditSchema.safeParse({ ...input, status: "pending" }).success).toBe(false);
    expect(QuickEditSchema.safeParse({ ...input, paid_amount: -1 }).success).toBe(false);
    expect(QuickEditSchema.safeParse({ ...input, adjuster_email: "nope" }).success).toBe(false);
    expect(
      QuickEditSchema.safeParse({ ...input, first_carrier_contact_at: "2026-11-16" }).success,
    ).toBe(false);
    expect(QuickEditSchema.safeParse({ ...input, assigned_to: "jane" }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("formats money", () => {
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(5000)).toBe("$5,000");
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(null)).toBe("—");
  });

  it("round-trips a datetime-local value", () => {
    expect(fromDateTimeLocal("")).toBeNull();
    const iso = fromDateTimeLocal("2026-11-16T10:05");
    expect(iso).not.toBeNull();
    expect(toDateTimeLocal(iso)).toBe("2026-11-16T10:05");
  });
});
