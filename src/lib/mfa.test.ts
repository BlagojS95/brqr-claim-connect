import { describe, expect, it } from "vitest";
import {
  formatTotpSecret,
  MFA_EXEMPT_SERVER_FNS,
  mfaBlocks,
  normalizeTotpCode,
  signInStep,
} from "./mfa";
import { SERVER_FN_ACCESS } from "./view-as";

describe("signInStep", () => {
  it("is done once the code was entered this session", () => {
    expect(signInStep({ currentLevel: "aal2", nextLevel: "aal2", required: true })).toBe("done");
  });
  it("asks for the code whenever an app is set up, required or not", () => {
    expect(signInStep({ currentLevel: "aal1", nextLevel: "aal2", required: false })).toBe("verify");
    expect(signInStep({ currentLevel: "aal1", nextLevel: "aal2", required: true })).toBe("verify");
  });
  it("makes a required login without an app enroll", () => {
    expect(signInStep({ currentLevel: "aal1", nextLevel: "aal1", required: true })).toBe("enroll");
  });
  it("lets everyone else in", () => {
    expect(signInStep({ currentLevel: "aal1", nextLevel: "aal1", required: false })).toBe("done");
  });
});

describe("mfaBlocks", () => {
  it("only lets aal2 sessions through", () => {
    expect(mfaBlocks({ aal: "aal2", fnName: "fetchAgencyOverview" })).toBe(false);
    expect(mfaBlocks({ aal: "aal1", fnName: "fetchAgencyOverview" })).toBe(true);
    expect(mfaBlocks({ aal: undefined, fnName: "fetchAgencyOverview" })).toBe(true);
  });
  it("exempts only the sign-in screens' functions", () => {
    expect(mfaBlocks({ aal: "aal1", fnName: "fetchMfaStatus" })).toBe(false);
    expect(mfaBlocks({ aal: "aal1", fnName: undefined })).toBe(true);
  });
  it("only exempts functions that are classified for view as client", () => {
    for (const name of MFA_EXEMPT_SERVER_FNS) expect(SERVER_FN_ACCESS).toHaveProperty(name);
  });
});

describe("totp helpers", () => {
  it("accepts six digits with or without spaces", () => {
    expect(normalizeTotpCode("123 456")).toBe("123456");
    expect(normalizeTotpCode("123456")).toBe("123456");
  });
  it("rejects anything else", () => {
    expect(normalizeTotpCode("12345")).toBeNull();
    expect(normalizeTotpCode("1234567")).toBeNull();
    expect(normalizeTotpCode("12a456")).toBeNull();
  });
  it("groups the secret by four", () => {
    expect(formatTotpSecret("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
    expect(formatTotpSecret("")).toBe("");
  });
});
