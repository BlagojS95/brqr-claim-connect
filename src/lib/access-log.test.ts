import { describe, expect, it } from "vitest";
import {
  ACCESS_DETAIL_MAX,
  ACCESS_LOG_PAGE_SIZE,
  accessActionLabel,
  claimLinkText,
  clampDetail,
  pageCount,
  pageRange,
} from "./access-log";

describe("accessActionLabel", () => {
  it("labels known actions", () => {
    expect(accessActionLabel("sign_in")).toBe("Signed in");
    expect(accessActionLabel("view_claim")).toBe("Viewed claim");
  });
  it("makes an unknown action readable", () => {
    expect(accessActionLabel("export_csv")).toBe("Export csv");
    expect(accessActionLabel("")).toBe("Unknown");
    expect(accessActionLabel("toString")).toBe("ToString");
  });
});

describe("clampDetail", () => {
  it("returns null for empty text and tidies whitespace", () => {
    expect(clampDetail(null)).toBeNull();
    expect(clampDetail("   ")).toBeNull();
    expect(clampDetail("  a \n b ")).toBe("a b");
  });
  it("cuts long text to the database limit", () => {
    const out = clampDetail("x".repeat(ACCESS_DETAIL_MAX + 50));
    expect(out).toHaveLength(ACCESS_DETAIL_MAX);
    expect(out?.endsWith("…")).toBe(true);
  });
});

describe("paging", () => {
  it("gives inclusive row ranges of 50", () => {
    expect(pageRange(0)).toEqual([0, 49]);
    expect(pageRange(2)).toEqual([100, 149]);
    expect(ACCESS_LOG_PAGE_SIZE).toBe(50);
  });
  it("treats a bad page as the first", () => {
    expect(pageRange(-1)).toEqual([0, 49]);
    expect(pageRange(1.5)).toEqual([0, 49]);
  });
  it("counts pages, at least one", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
  });
});

describe("claimLinkText", () => {
  it("uses the claim number when there is one", () => {
    expect(claimLinkText(" HFD-1 ")).toBe("Claim HFD-1");
    expect(claimLinkText(null)).toBe("Claim");
  });
});
