import { describe, expect, it } from "vitest";
import {
  AdvocateContactSchema,
  AdvocateDefaultsSchema,
  hasAdvocateInfo,
  resolveClaimsAdvocate,
  telHref,
} from "@/lib/claims-advocate";

const noClient = { advocate_name: null, advocate_phone: null, advocate_email: null };
const settings = {
  default_advocate_name: "Dana Default",
  default_advocate_phone: "555-000-1111",
  default_advocate_email: "claims@brqr.com",
  after_hours_claims_phone: "800-555-0199",
};

describe("resolveClaimsAdvocate", () => {
  it("uses the client's own advocate when one is set", () => {
    const info = resolveClaimsAdvocate(
      { advocate_name: "Alex Own", advocate_phone: " ", advocate_email: "alex@brqr.com" },
      settings,
    );
    expect(info.advocate).toEqual({ name: "Alex Own", phone: null, email: "alex@brqr.com" });
    expect(info.isDefault).toBe(false);
    expect(info.afterHoursPhone).toBe("800-555-0199");
  });

  it("falls back to the agency default, without mixing fields", () => {
    const info = resolveClaimsAdvocate(noClient, settings);
    expect(info.advocate?.name).toBe("Dana Default");
    expect(info.isDefault).toBe(true);
  });

  it("has nothing to show when nothing is set up", () => {
    const info = resolveClaimsAdvocate(null, null);
    expect(info).toEqual({ advocate: null, isDefault: false, afterHoursPhone: null });
    expect(hasAdvocateInfo(info)).toBe(false);
  });

  it("shows the after-hours number on its own", () => {
    const info = resolveClaimsAdvocate(noClient, {
      default_advocate_name: null,
      default_advocate_phone: null,
      default_advocate_email: null,
      after_hours_claims_phone: "800-555-0199",
    });
    expect(info.advocate).toBeNull();
    expect(hasAdvocateInfo(info)).toBe(true);
  });
});

describe("telHref", () => {
  it("keeps only digits, a leading plus and an extension", () => {
    expect(telHref("(555) 123-4567")).toBe("tel:5551234567");
    expect(telHref("+1 555.123.4567")).toBe("tel:+15551234567");
    expect(telHref("555-123-4567 ext. 22")).toBe("tel:5551234567,22");
    expect(telHref("555-123-4567 x22")).toBe("tel:5551234567,22");
  });
});

describe("advocate input", () => {
  it("treats blank fields as not set", () => {
    expect(AdvocateContactSchema.parse({ name: " ", phone: "", email: "" })).toEqual({
      name: null,
      phone: null,
      email: null,
    });
  });

  it("rejects a bad email or phone", () => {
    expect(AdvocateContactSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(AdvocateContactSchema.safeParse({ phone: "call me" }).success).toBe(false);
    expect(
      AdvocateDefaultsSchema.safeParse({ advocate: {}, afterHoursPhone: "800-555-0199" }).success,
    ).toBe(true);
  });
});
