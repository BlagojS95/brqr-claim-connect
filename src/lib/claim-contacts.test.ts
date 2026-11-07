import { describe, expect, it } from "vitest";
import { applyContactDefaults, DEFAULT_BROKER_CLAIMS_EMAIL } from "@/lib/claim-contacts";

const row = (
  row_key: string,
  fields: Partial<Record<"contact_person" | "phone" | "email", string>> = {},
) => ({
  row_key,
  contact_person: fields.contact_person ?? null,
  phone: fields.phone ?? null,
  email: fields.email ?? null,
});

const claim = {
  adjuster_name: "Ann Adjuster",
  adjuster_email: "ann@carrier.com",
  adjuster_phone: "555-0100",
};

const allRows = [
  row("other_2"),
  row("other_1"),
  row("attorney"),
  row("adjuster"),
  row("broker_claims_contact", { email: "someone.personal@gmail.com" }),
];

describe("applyContactDefaults", () => {
  it("orders the rows and drops the second Other row", () => {
    const keys = applyContactDefaults(allRows, claim, null).map((r) => r.row_key);
    expect(keys).toEqual(["broker_claims_contact", "adjuster", "attorney", "other_1"]);
  });

  it("fills empty adjuster fields from the claim but keeps typed values", () => {
    const [, adjuster] = applyContactDefaults(
      [row("broker_claims_contact"), row("adjuster", { phone: "555-9999" })],
      claim,
      null,
    );
    expect(adjuster).toMatchObject({
      contact_person: "Ann Adjuster",
      email: "ann@carrier.com",
      phone: "555-9999",
    });
  });

  it("uses the agency settings email for the broker row", () => {
    const [broker] = applyContactDefaults(allRows, claim, "inbox@brqr.com");
    expect(broker.email).toBe("inbox@brqr.com");
  });

  it("falls back to the default inbox when there is no setting", () => {
    expect(applyContactDefaults(allRows, claim, undefined)[0].email).toBe(
      DEFAULT_BROKER_CLAIMS_EMAIL,
    );
    expect(applyContactDefaults(allRows, claim, "  ")[0].email).toBe("claims@brqr.com");
  });
});
