import { describe, expect, it } from "vitest";
import { carrierUpdatedText, latestCarrierUpdate } from "@/lib/data-freshness";
import { carrierDataChanged } from "@/lib/claim-quick-edit";

describe("latestCarrierUpdate", () => {
  it("picks the newest, ignoring nulls and junk", () => {
    expect(
      latestCarrierUpdate([
        { carrier_updated_at: null },
        { carrier_updated_at: "2026-11-01T10:00:00Z" },
        { carrier_updated_at: "nonsense" },
        { carrier_updated_at: "2026-11-16T20:05:00Z" },
      ]),
    ).toBe("2026-11-16T20:05:00Z");
  });
  it("is null with nothing to show", () => {
    expect(latestCarrierUpdate([])).toBeNull();
    expect(carrierUpdatedText(null)).toMatch(/No carrier updates/);
    expect(carrierUpdatedText("2026-11-16T20:05:00Z")).toBe(
      "Last updated from carrier 11/16/2026, 3:05 PM ET",
    );
  });
});

describe("carrierDataChanged", () => {
  const change = (field: string) => ({ field, label: field, from: "a", to: "b" }) as never;
  it("is true for claim number, status, paid, reserve and adjuster fields", () => {
    for (const f of [
      "claim_number",
      "status",
      "paid_amount",
      "reserve_amount",
      "adjuster_name",
      "adjuster_phone",
      "adjuster_email",
    ]) {
      expect(carrierDataChanged([change(f)])).toBe(true);
    }
  });
  it("is false for staff-only fields", () => {
    expect(carrierDataChanged([change("waiting_on"), change("assigned_to")])).toBe(false);
    expect(carrierDataChanged([])).toBe(false);
  });
});
