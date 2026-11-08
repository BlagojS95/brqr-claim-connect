import { describe, expect, it } from "vitest";
import { CLAIM_STATUSES } from "@/lib/claim-status";
import { BRAND_SERIES_COLORS, STATUS_COLORS, seriesColor, statusColor } from "@/lib/status-colors";

describe("status colors", () => {
  it("gives every status a hex, bar and badge colour", () => {
    for (const status of CLAIM_STATUSES) {
      const color = STATUS_COLORS[status];
      expect(color, status).toBeDefined();
      expect(color.hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(color.bar).toMatch(/^bg-/);
      expect(color.badge).toContain("bg-");
      expect(color.badge).toContain("text-");
      expect(color.badge).toContain("border-");
    }
  });

  it("uses a different colour for each status", () => {
    const hexes = CLAIM_STATUSES.map((s) => STATUS_COLORS[s].hex.toLowerCase());
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it("has no colours for unknown statuses beyond the fallback", () => {
    expect(Object.keys(STATUS_COLORS).sort()).toEqual([...CLAIM_STATUSES].sort());
    expect(statusColor("not-a-status").badge).toContain("bg-muted");
  });

  it("cycles the brand series palette", () => {
    expect(seriesColor(0)).toBe("#0c2340");
    expect(seriesColor(BRAND_SERIES_COLORS.length)).toBe(seriesColor(0));
  });
});
