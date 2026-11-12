// The Insights chart cards (fix 45), in display order. Four breakdown cards
// start on line, carrier, cause and location and each has a selector to show
// any other breakdown; status and the two time charts are fixed.

import { BREAKDOWN_LABELS, type BreakdownDimension } from "@/lib/insights-breakdowns";
import { measureNoun, type InsightsMeasure } from "@/lib/insights-measure";

export type ChartCardKind = "breakdown" | "status" | "trend" | "amounts";

export interface ChartCardSpec {
  id: string;
  kind: ChartCardKind;
  /** The breakdown a breakdown card starts on. */
  dimension?: BreakdownDimension;
  wide?: boolean;
}

export const INSIGHTS_CARDS: readonly ChartCardSpec[] = [
  { id: "breakdown-1", kind: "breakdown", dimension: "line" },
  { id: "status", kind: "status" },
  { id: "trend", kind: "trend" },
  { id: "amounts", kind: "amounts" },
  { id: "breakdown-2", kind: "breakdown", dimension: "carrier", wide: true },
  { id: "breakdown-3", kind: "breakdown", dimension: "cause" },
  { id: "breakdown-4", kind: "breakdown", dimension: "location" },
];

export function chartCardTitle(
  card: Pick<ChartCardSpec, "kind">,
  measure: InsightsMeasure,
  dimension?: BreakdownDimension,
): string {
  const noun = measureNoun(measure);
  switch (card.kind) {
    case "breakdown":
      return `${noun} by ${BREAKDOWN_LABELS[dimension ?? "line"]}`;
    case "status":
      return `${noun} by Status`;
    case "trend":
      return `${noun} over Time`;
    case "amounts":
      // Not driven by the measure: always compares the two amounts.
      return "Paid and Incurred over Time";
  }
}
