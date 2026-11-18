import { describe, expect, it } from "vitest";
import {
  carrierEmailActivityBody,
  claimTemplateValues,
  defaultCarrierRecipient,
  EMAIL_PLACEHOLDERS,
  fillTemplate,
  isValidEmail,
  unknownPlaceholders,
  type EmailTemplateClaim,
} from "./email-templates";

const claim: EmailTemplateClaim = {
  claim_number: "CLM-123",
  date_of_loss: "2026-09-09",
  adjuster_name: "Pat Adjuster",
  policy_number: "GL-555",
  line_of_business: "General Liability",
  carrier: "Acme Mutual",
  claimant_name: "Jordan Doe",
  loss_location: "12 Main St",
  description: "Slip and fall in the lobby",
};

const extra = { insured: "Widget Co", brokerClaimsEmail: "claims@brqr.com" };

describe("claimTemplateValues", () => {
  it("fills every placeholder from the claim", () => {
    const values = claimTemplateValues(claim, extra);
    expect(values).toEqual({
      claim_number: "CLM-123",
      date_of_loss: "9/9/2026",
      insured: "Widget Co",
      adjuster_name: "Pat Adjuster",
      policy_number: "GL-555",
      line_of_business: "General Liability",
      carrier: "Acme Mutual",
      claimant_name: "Jordan Doe",
      loss_location: "12 Main St",
      description: "Slip and fall in the lobby",
      broker_claims_email: "claims@brqr.com",
    });
    expect(Object.keys(values).sort()).toEqual([...EMAIL_PLACEHOLDERS].sort());
  });

  it("formats the date of loss as a calendar date, with no time zone shift", () => {
    expect(claimTemplateValues({ ...claim, date_of_loss: "2026-01-01" }, extra).date_of_loss).toBe(
      "1/1/2026",
    );
  });

  it("uses readable stand-ins for missing values", () => {
    const empty: EmailTemplateClaim = {
      claim_number: null,
      date_of_loss: null,
      adjuster_name: "  ",
      policy_number: "",
      line_of_business: null,
      carrier: null,
      claimant_name: null,
      loss_location: null,
      description: null,
    };
    const values = claimTemplateValues(empty, { insured: null, brokerClaimsEmail: null });
    expect(values.claim_number).toBe("pending");
    expect(values.date_of_loss).toBe("—");
    expect(values.adjuster_name).toBe("Claims Adjuster");
    expect(values.policy_number).toBe("—");
    expect(values.insured).toBe("—");
    expect(values.broker_claims_email).toBe("claims@brqr.com");
  });
});

describe("fillTemplate", () => {
  const values = claimTemplateValues(claim, extra);

  it("replaces known placeholders, including repeats", () => {
    expect(
      fillTemplate("Claim {claim_number} for {insured} ({insured}), DOL {date_of_loss}", values),
    ).toBe("Claim CLM-123 for Widget Co (Widget Co), DOL 9/9/2026");
  });

  it("leaves unknown placeholders and other braces as typed", () => {
    expect(fillTemplate("Hi {first_name}, ref {claim_number} {Claim_Number} {}", values)).toBe(
      "Hi {first_name}, ref CLM-123 {Claim_Number} {}",
    );
  });

  it("does not re-expand placeholders that appear inside claim values", () => {
    const tricky = claimTemplateValues({ ...claim, description: "see {claim_number}" }, extra);
    expect(fillTemplate("{description}", tricky)).toBe("see {claim_number}");
  });

  it("keeps line breaks", () => {
    expect(fillTemplate("Hello {adjuster_name},\n\nThanks", values)).toBe(
      "Hello Pat Adjuster,\n\nThanks",
    );
  });
});

describe("unknownPlaceholders", () => {
  it("lists each unsupported placeholder once", () => {
    expect(unknownPlaceholders("{claim_number} {foo} {bar} {foo}")).toEqual(["foo", "bar"]);
    expect(unknownPlaceholders("{claim_number} {insured}")).toEqual([]);
  });
});

describe("defaultCarrierRecipient", () => {
  it("prefers the carrier email, then the adjuster, else blank", () => {
    expect(defaultCarrierRecipient({ carrier_email: " c@x.com ", adjuster_email: "a@x.com" })).toBe(
      "c@x.com",
    );
    expect(defaultCarrierRecipient({ carrier_email: "", adjuster_email: "a@x.com" })).toBe(
      "a@x.com",
    );
    expect(defaultCarrierRecipient({ carrier_email: null, adjuster_email: null })).toBe("");
  });
});

describe("isValidEmail", () => {
  it("accepts one ordinary address", () => {
    expect(isValidEmail("claims@carrier.com")).toBe(true);
    expect(isValidEmail("  first.last+tag@sub.carrier.co.uk ")).toBe(true);
  });

  it("rejects blanks, missing parts and lists", () => {
    for (const bad of [
      "",
      "claims",
      "claims@",
      "@carrier.com",
      "a@b",
      "a b@c.com",
      "a@b.com, c@d.com",
      "a@b.com;c@d.com",
    ]) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });
});

describe("carrierEmailActivityBody", () => {
  it("names the recipient, template and subject", () => {
    expect(carrierEmailActivityBody("c@x.com", "Status request", "Status Request - Claim 1")).toBe(
      "Email sent to carrier (c@x.com): Status request — Status Request - Claim 1",
    );
  });

  it("stays within the activity log's 4000 characters", () => {
    expect(carrierEmailActivityBody("c@x.com", "T", "s".repeat(5000)).length).toBe(4000);
  });
});
