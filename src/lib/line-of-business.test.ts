import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_CODES,
  LINE_OF_BUSINESS_NAMES,
  isLineOfBusinessCode,
  lineOfBusinessName,
} from "@/lib/line-of-business";

describe("line of business constants", () => {
  it("has a name for every code", () => {
    expect(Object.keys(LINE_OF_BUSINESS_NAMES)).toEqual([...LINE_OF_BUSINESS_CODES]);
    expect(lineOfBusinessName(LINE_OF_BUSINESS.workersComp)).toBe("Workers Compensation");
  });

  it("matches the rows seeded into the lines_of_business table", () => {
    const sql = readFileSync("supabase/migrations/20261101000000_lines_of_business.sql", "utf8");
    for (const code of LINE_OF_BUSINESS_CODES) {
      expect(sql).toContain(`('${code}', '${LINE_OF_BUSINESS_NAMES[code]}',`);
    }
  });

  it("recognises codes but not names", () => {
    expect(isLineOfBusinessCode("GL")).toBe(true);
    expect(isLineOfBusinessCode("General Liability")).toBe(false);
  });
});
