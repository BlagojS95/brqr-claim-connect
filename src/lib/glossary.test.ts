import { describe, expect, it } from "vitest";
import { CLAIM_STATUSES, CLAIM_STATUS_LABELS } from "@/lib/claim-status";
import { INSIGHTS_MEASURE, INSIGHTS_MEASURES } from "@/lib/insights-measure";
import {
  GLOSSARY_TERMS,
  MEASURE_TERM,
  STATUS_HELP,
  TERM_HELP,
  glossaryPlainText,
  statusGlossaryEntry,
  termGlossaryEntry,
} from "@/lib/glossary";

describe("glossary", () => {
  it("explains every claim status with a meaning, next step and timing", () => {
    expect(Object.keys(STATUS_HELP).sort()).toEqual([...CLAIM_STATUSES].sort());
    for (const status of CLAIM_STATUSES) {
      const help = STATUS_HELP[status];
      expect(help.meaning.trim(), status).not.toBe("");
      expect(help.nextStep.trim(), status).not.toBe("");
      expect(help.timing.trim(), status).not.toBe("");
    }
  });

  it("titles a status entry with the status label shown on the badge", () => {
    for (const status of CLAIM_STATUSES) {
      const entry = statusGlossaryEntry(status);
      expect(entry.title).toBe(CLAIM_STATUS_LABELS[status]);
      expect(entry.lines.map((l) => l.label)).toEqual([undefined, "Next step", "Typical timing"]);
    }
  });

  it("defines every term, including the ones the plan names", () => {
    for (const term of [
      "reserve",
      "incurred",
      "paid",
      "subrogation",
      "lossRun",
      "valuationDate",
    ] as const) {
      expect(GLOSSARY_TERMS).toContain(term);
    }
    for (const term of GLOSSARY_TERMS) {
      expect(TERM_HELP[term].title.trim(), term).not.toBe("");
      expect(TERM_HELP[term].definition.trim(), term).not.toBe("");
      expect(termGlossaryEntry(term).lines).toHaveLength(1);
    }
  });

  it("has help for every money measure on Insights and none for the count", () => {
    for (const measure of INSIGHTS_MEASURES) {
      if (measure === INSIGHTS_MEASURE.count) expect(MEASURE_TERM[measure]).toBeUndefined();
      else expect(MEASURE_TERM[measure]).toBe(measure);
    }
  });

  it("flattens an entry to one line of text", () => {
    expect(glossaryPlainText(statusGlossaryEntry("closed"))).toMatch(
      /^The carrier has finished .* Next step: .* Typical timing: /,
    );
  });
});
