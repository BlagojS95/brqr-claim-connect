import { describe, expect, it } from "vitest";
import { ERROR_TEXT, plainErrorMessage } from "./error-messages";

describe("plainErrorMessage", () => {
  it("never shows raw server text", () => {
    expect(plainErrorMessage(new Error("Failed to fetch"))).toBe(ERROR_TEXT.offline);
    expect(plainErrorMessage(new Error("JWT expired"))).toBe(ERROR_TEXT.session);
    expect(plainErrorMessage(new Error("permission denied for table claims"))).toBe(
      ERROR_TEXT.access,
    );
    expect(plainErrorMessage(new Error("duplicate key value violates unique constraint"))).toBe(
      ERROR_TEXT.generic,
    );
    expect(plainErrorMessage(undefined)).toBe(ERROR_TEXT.generic);
  });
});
