import { describe, expect, it } from "vitest";
import { CLAIM_STATUS } from "@/lib/claim-status";
import {
  findDuplicateClaims,
  normalizeForMatch,
  type DuplicateCandidate,
  type DuplicateProbe,
} from "@/lib/duplicate-claims";

const LINE = "44444444-4444-4444-8444-444444444444";
const OTHER_LINE = "66666666-6666-4666-8666-666666666666";

const candidate = (overrides: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id: "c1",
  claim_number: "CLM-1",
  claim_type: "General Liability",
  status: CLAIM_STATUS.open,
  date_of_loss: "2026-11-01",
  line_of_business_id: LINE,
  claimant_name: "Jane Doe",
  employee_name: null,
  vehicles_involved: null,
  ...overrides,
});

const probe = (overrides: Partial<DuplicateProbe> = {}): DuplicateProbe => ({
  dateOfLoss: "2026-11-01",
  lineOfBusinessId: LINE,
  claimantName: "Jane Doe",
  ...overrides,
});

const ids = (p: DuplicateProbe, cs: DuplicateCandidate[]) =>
  findDuplicateClaims(p, cs).map((m) => m.id);

describe("normalizeForMatch", () => {
  it("ignores case and all whitespace", () => {
    expect(normalizeForMatch("  Jane\t DOE ")).toBe("janedoe");
    expect(normalizeForMatch("Jane Doe")).toBe(normalizeForMatch("janedoe"));
  });

  it("treats blank text as nothing", () => {
    expect(normalizeForMatch("   ")).toBeNull();
    expect(normalizeForMatch("")).toBeNull();
    expect(normalizeForMatch(null)).toBeNull();
    expect(normalizeForMatch(undefined)).toBeNull();
  });
});

describe("findDuplicateClaims", () => {
  it("matches the same date, line and claimant", () => {
    expect(ids(probe(), [candidate()])).toEqual(["c1"]);
  });

  it("matches names regardless of case and spacing", () => {
    expect(ids(probe({ claimantName: "  JANE   doe " }), [candidate()])).toEqual(["c1"]);
  });

  it("needs the same date of loss", () => {
    expect(ids(probe(), [candidate({ date_of_loss: "2026-11-02" })])).toEqual([]);
    expect(ids(probe(), [candidate({ date_of_loss: null })])).toEqual([]);
  });

  it("needs the same line of business", () => {
    expect(ids(probe(), [candidate({ line_of_business_id: OTHER_LINE })])).toEqual([]);
    expect(ids(probe(), [candidate({ line_of_business_id: null })])).toEqual([]);
  });

  it("needs the same person or vehicle", () => {
    expect(ids(probe({ claimantName: "John Roe" }), [candidate()])).toEqual([]);
  });

  it("treats a claimant and an employee with the same name as the same person", () => {
    expect(ids(probe({ claimantName: null, employeeName: "Jane Doe" }), [candidate()])).toEqual([
      "c1",
    ]);
    expect(ids(probe(), [candidate({ claimant_name: null, employee_name: "jane doe" })])).toEqual([
      "c1",
    ]);
  });

  it("matches the same vehicle text even with different people", () => {
    expect(
      ids(probe({ claimantName: "Driver A", vehiclesInvolved: "Unit 12 - 2019 Ford F-150" }), [
        candidate({ claimant_name: "Driver B", vehicles_involved: "unit 12 -  2019 ford f-150" }),
      ]),
    ).toEqual(["c1"]);
  });

  it("never matches on blank names or vehicles", () => {
    const blankCandidate = candidate({ claimant_name: "  ", vehicles_involved: "" });
    expect(ids(probe({ claimantName: "  ", vehiclesInvolved: " " }), [blankCandidate])).toEqual([]);
    expect(ids(probe({ claimantName: null }), [candidate({ claimant_name: null })])).toEqual([]);
    expect(
      ids(probe({ claimantName: null, vehiclesInvolved: "Truck" }), [
        candidate({ claimant_name: null, vehicles_involved: null }),
      ]),
    ).toEqual([]);
  });

  it("never reports the new claim as its own duplicate", () => {
    expect(ids(probe({ claimId: "c1" }), [candidate()])).toEqual([]);
  });

  it("returns every match with the fields the form shows", () => {
    const matches = findDuplicateClaims(probe(), [
      candidate(),
      candidate({ id: "c2", claim_number: null, status: CLAIM_STATUS.submitted }),
      candidate({ id: "c3", claimant_name: "Someone Else" }),
    ]);
    expect(matches).toEqual([
      {
        id: "c1",
        claim_number: "CLM-1",
        claim_type: "General Liability",
        status: CLAIM_STATUS.open,
        date_of_loss: "2026-11-01",
      },
      {
        id: "c2",
        claim_number: null,
        claim_type: "General Liability",
        status: CLAIM_STATUS.submitted,
        date_of_loss: "2026-11-01",
      },
    ]);
  });
});
