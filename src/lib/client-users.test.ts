import { describe, expect, it } from "vitest";
import {
  CLIENT_USER_ROLE,
  InviteClientUserSchema,
  isCompanyWide,
  LocationSchema,
  locationNames,
  teamChangeError,
  UpdateClientUserSchema,
} from "./client-users";

const LOC_A = "11111111-1111-4111-8111-111111111111";
const LOC_B = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

describe("isCompanyWide", () => {
  it("is true for admins and company users only", () => {
    expect(isCompanyWide("client_admin")).toBe(true);
    expect(isCompanyWide("company")).toBe(true);
    expect(isCompanyWide("location")).toBe(false);
    expect(isCompanyWide(null)).toBe(false);
  });
});

describe("InviteClientUserSchema", () => {
  const base = { name: " Jane Roe ", email: " Jane@Acme.com ", password: "longenough" };

  it("trims the name and lower-cases the email", () => {
    const parsed = InviteClientUserSchema.parse({ ...base, role: "company", locationIds: [] });
    expect(parsed.name).toBe("Jane Roe");
    expect(parsed.email).toBe("jane@acme.com");
  });

  it("needs a location for a location user", () => {
    expect(
      InviteClientUserSchema.safeParse({ ...base, role: "location", locationIds: [] }).success,
    ).toBe(false);
    expect(
      InviteClientUserSchema.safeParse({ ...base, role: "location", locationIds: [LOC_A] }).success,
    ).toBe(true);
  });

  it("rejects short passwords and unknown roles", () => {
    expect(
      InviteClientUserSchema.safeParse({
        ...base,
        password: "short",
        role: "company",
        locationIds: [],
      }).success,
    ).toBe(false);
    expect(
      InviteClientUserSchema.safeParse({ ...base, role: "agency_admin", locationIds: [] }).success,
    ).toBe(false);
  });
});

describe("UpdateClientUserSchema", () => {
  it("needs a location for a location user", () => {
    expect(
      UpdateClientUserSchema.safeParse({ userId: USER, role: "location", locationIds: [] }).success,
    ).toBe(false);
    expect(
      UpdateClientUserSchema.safeParse({ userId: USER, role: "company", locationIds: [] }).success,
    ).toBe(true);
  });
});

describe("LocationSchema", () => {
  it("trims and turns an empty address into null", () => {
    expect(LocationSchema.parse({ name: " HQ ", address: "  " })).toEqual({
      name: "HQ",
      address: null,
    });
    expect(LocationSchema.safeParse({ name: "  " }).success).toBe(false);
  });
});

describe("teamChangeError", () => {
  const teammate = { isPrimary: false, isYou: false };

  it("lets an admin change or remove a teammate", () => {
    expect(
      teamChangeError(teammate, { kind: "update", role: CLIENT_USER_ROLE.location }),
    ).toBeNull();
    expect(teamChangeError(teammate, { kind: "remove" })).toBeNull();
  });

  it("stops admins removing or demoting themselves", () => {
    const me = { isPrimary: false, isYou: true };
    expect(teamChangeError(me, { kind: "remove" })).toMatch(/own login/);
    expect(teamChangeError(me, { kind: "update", role: CLIENT_USER_ROLE.company })).toMatch(
      /own access/,
    );
    expect(teamChangeError(me, { kind: "update", role: CLIENT_USER_ROLE.clientAdmin })).toBeNull();
  });

  it("keeps the main login as an admin", () => {
    const primary = { isPrimary: true, isYou: false };
    expect(teamChangeError(primary, { kind: "remove" })).toMatch(/main login/);
    expect(teamChangeError(primary, { kind: "update", role: CLIENT_USER_ROLE.location })).toMatch(
      /main login/,
    );
  });
});

describe("locationNames", () => {
  it("returns known names A to Z and skips unknown ids", () => {
    const locations = [
      { id: LOC_A, name: "Warehouse", address: null },
      { id: LOC_B, name: "Dayton Yard", address: null },
    ];
    expect(locationNames([LOC_A, LOC_B, USER], locations)).toEqual(["Dayton Yard", "Warehouse"]);
  });
});
