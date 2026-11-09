// One colour per claim status, used by status badges, the Home status bars
// and the Insights charts. Change a colour here, never in a component.
//
// Class strings are written out in full so Tailwind finds them when it scans
// the source.

import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";

export interface StatusColor {
  /** Solid colour as hex, for recharts fills and strokes. */
  hex: string;
  /** Solid background in the same colour, for bars and dots. */
  bar: string;
  /** Tinted background, text and border, for badges. */
  badge: string;
}

export const STATUS_COLORS: Record<ClaimStatus, StatusColor> = {
  [CLAIM_STATUS.notice]: {
    hex: "#2d8a9e",
    bar: "bg-[#2d8a9e]",
    badge: "bg-[#2d8a9e]/10 text-[#1f6475] border-[#2d8a9e]/40",
  },
  [CLAIM_STATUS.submitted]: {
    hex: "#c9a84c",
    bar: "bg-gold",
    badge: "bg-gold/20 text-gold-foreground border-gold/50",
  },
  [CLAIM_STATUS.open]: {
    hex: "#0c2340",
    bar: "bg-navy",
    badge: "bg-navy/10 text-navy border-navy/30",
  },
  [CLAIM_STATUS.closed]: {
    hex: "#9ca3af",
    bar: "bg-[#9ca3af]",
    badge: "bg-[#9ca3af]/15 text-gray-700 border-[#9ca3af]/50",
  },
  [CLAIM_STATUS.reopened]: {
    hex: "#ea580c",
    bar: "bg-[#ea580c]",
    badge: "bg-[#ea580c]/10 text-orange-800 border-[#ea580c]/40",
  },
};

const FALLBACK: StatusColor = {
  hex: "#9ca3af",
  bar: "bg-muted-foreground/40",
  badge: "bg-muted text-muted-foreground border-border",
};

export function statusColor(status: string): StatusColor {
  return (STATUS_COLORS as Record<string, StatusColor | undefined>)[status] ?? FALLBACK;
}

/**
 * Brand palette for chart series that are not statuses (carriers, lines of
 * business): navy, teal, gold, then lighter tints of each.
 */
export const BRAND_SERIES_COLORS = [
  "#0c2340",
  "#2d8a9e",
  "#c9a84c",
  "#3d5a80",
  "#6cb4c4",
  "#dfc583",
  "#8a9bb4",
  "#a9d3dc",
] as const;

/** Grey for chart rows that aren't a real group, like "Not given" or "All other". */
export const NEUTRAL_SERIES_COLOR = "#9ca3af";

export function seriesColor(index: number): string {
  return BRAND_SERIES_COLORS[index % BRAND_SERIES_COLORS.length];
}
