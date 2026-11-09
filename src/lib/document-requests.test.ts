import { describe, expect, it } from "vitest";
import {
  MAX_REQUEST_NAME_LENGTH,
  MAX_REQUEST_NOTE_LENGTH,
  isFulfilled,
  receivedDate,
  splitDocumentRequests,
  validateDocumentRequest,
} from "@/lib/document-requests";

const req = (id: string, requested_at: string, fulfilled_at: string | null = null) => ({
  id,
  requested_at,
  fulfilled_at,
});

describe("splitDocumentRequests", () => {
  it("separates open from fulfilled", () => {
    const { open, fulfilled } = splitDocumentRequests([
      req("a", "2026-11-01T10:00:00Z"),
      req("b", "2026-11-02T10:00:00Z", "2026-11-05T10:00:00Z"),
      req("c", "2026-11-03T10:00:00Z"),
    ]);
    expect(open.map((r) => r.id)).toEqual(["a", "c"]);
    expect(fulfilled.map((r) => r.id)).toEqual(["b"]);
  });

  it("orders open oldest first and fulfilled newest received first", () => {
    const { open, fulfilled } = splitDocumentRequests([
      req("late", "2026-11-04T10:00:00Z"),
      req("early", "2026-11-01T10:00:00Z"),
      req("got1", "2026-11-01T10:00:00Z", "2026-11-02T10:00:00Z"),
      req("got2", "2026-11-01T10:00:00Z", "2026-11-06T10:00:00Z"),
    ]);
    expect(open.map((r) => r.id)).toEqual(["early", "late"]);
    expect(fulfilled.map((r) => r.id)).toEqual(["got2", "got1"]);
  });

  it("handles an empty list and does not mutate the input", () => {
    expect(splitDocumentRequests([])).toEqual({ open: [], fulfilled: [] });
    const input = [req("b", "2026-11-02"), req("a", "2026-11-01")];
    splitDocumentRequests(input);
    expect(input.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("isFulfilled follows fulfilled_at", () => {
    expect(isFulfilled({ fulfilled_at: null })).toBe(false);
    expect(isFulfilled({ fulfilled_at: "2026-11-02T10:00:00Z" })).toBe(true);
  });
});

describe("validateDocumentRequest", () => {
  it("trims the name and turns a blank note into null", () => {
    expect(validateDocumentRequest({ name: "  Police report ", note: "   " })).toEqual({
      ok: true,
      value: { name: "Police report", note: null },
    });
    expect(validateDocumentRequest({ name: "Photos", note: " front and back " })).toEqual({
      ok: true,
      value: { name: "Photos", note: "front and back" },
    });
    expect(validateDocumentRequest({ name: "Photos" })).toEqual({
      ok: true,
      value: { name: "Photos", note: null },
    });
  });

  it("requires a name", () => {
    expect(validateDocumentRequest({ name: "   " }).ok).toBe(false);
  });

  it("enforces the table limits", () => {
    expect(validateDocumentRequest({ name: "x".repeat(MAX_REQUEST_NAME_LENGTH) }).ok).toBe(true);
    expect(validateDocumentRequest({ name: "x".repeat(MAX_REQUEST_NAME_LENGTH + 1) }).ok).toBe(
      false,
    );
    expect(
      validateDocumentRequest({ name: "x", note: "y".repeat(MAX_REQUEST_NOTE_LENGTH + 1) }).ok,
    ).toBe(false);
  });
});

describe("receivedDate", () => {
  it("puts the timestamp on the agency calendar", () => {
    // 03:00 UTC on the 9th is still the evening of the 8th in New York.
    expect(receivedDate("2026-11-09T03:00:00Z")).toBe("2026-11-08");
    expect(receivedDate("2026-11-09T15:00:00+00:00")).toBe("2026-11-09");
  });

  it("returns null for nothing or garbage", () => {
    expect(receivedDate(null)).toBeNull();
    expect(receivedDate(undefined)).toBeNull();
    expect(receivedDate("not a date")).toBeNull();
  });
});
