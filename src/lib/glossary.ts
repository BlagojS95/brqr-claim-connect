// Plain-English help (fix 49). This file is the ONLY place the wording lives:
// every tooltip on a status badge or a labelled number reads from here, so the
// agency can change an explanation by editing just this file.
//
// Keep each entry short enough to read on a phone: one or two sentences.

import { CLAIM_STATUS_LABELS, type ClaimStatus } from "@/lib/claim-status";
import { INSIGHTS_MEASURE, type InsightsMeasure } from "@/lib/insights-measure";

export interface StatusHelp {
  /** What the status means for the client. */
  meaning: string;
  /** What usually happens next. */
  nextStep: string;
  /** How long this stage usually lasts. */
  timing: string;
}

export const STATUS_HELP: Record<ClaimStatus, StatusHelp> = {
  notice: {
    meaning:
      "You told us about an incident for the record only. It has not been sent to the insurance company as a claim.",
    nextStep:
      "Nothing, unless costs or injuries come up. Then ask us to turn it into a full claim.",
    timing: "Stays a notice until you or the agency change it.",
  },
  submitted: {
    meaning:
      "Your claim has been reported and the agency is sending it to the insurance company (the carrier).",
    nextStep: "The carrier gives the claim a number and assigns an adjuster to handle it.",
    timing: "Usually 1 to 3 business days.",
  },
  open: {
    meaning:
      "The carrier has accepted the claim and an adjuster is working on it: investigating, paying bills and setting money aside.",
    nextStep:
      "The adjuster may ask you for documents or statements. Payments are made as bills come in.",
    timing: "Weeks for simple property or auto claims; months or longer for injuries.",
  },
  closed: {
    meaning: "The carrier has finished the claim. No more payments are expected.",
    nextStep: "Nothing. The final amounts stay on your loss history.",
    timing: "Final. A closed claim can be reopened if new costs appear.",
  },
  reopened: {
    meaning:
      "A closed claim has been opened again, usually because new bills or information came in.",
    nextStep: "The adjuster handles the new costs, then closes the claim again.",
    timing: "Usually shorter than the first time; depends on the new costs.",
  },
};

export const GLOSSARY_TERMS = [
  "status",
  "paid",
  "reserve",
  "incurred",
  "recovery",
  "netIncurred",
  "subrogation",
  "lossRun",
  "valuationDate",
  "waitingOn",
  "carrierUpdated",
] as const;

export type GlossaryTerm = (typeof GLOSSARY_TERMS)[number];

export interface TermHelp {
  /** The name as shown in the tooltip heading. */
  title: string;
  definition: string;
}

export const TERM_HELP: Record<GlossaryTerm, TermHelp> = {
  status: {
    title: "Claim status",
    definition:
      "Where the claim stands: Notice (for the record only), Submitted (on its way to the carrier), Open (being handled), Closed (finished) or Reopened.",
  },
  paid: {
    title: "Paid",
    definition: "Money the insurance company has already paid out on the claim.",
  },
  reserve: {
    title: "Reserve",
    definition:
      "Money the insurance company has set aside for payments it still expects to make. It is an estimate and can go up or down.",
  },
  incurred: {
    title: "Incurred",
    definition:
      "The expected total cost of the claim: what has been paid plus the reserve still set aside.",
  },
  recovery: {
    title: "Recovery",
    definition:
      "Money the insurance company got back, for example from the party at fault (subrogation) or by selling damaged property (salvage).",
  },
  netIncurred: {
    title: "Net incurred",
    definition: "Incurred minus any recoveries: what the claim is expected to cost in the end.",
  },
  subrogation: {
    title: "Subrogation",
    definition:
      "When your insurance company pays your claim and then collects that money from the person or company who caused the loss.",
  },
  lossRun: {
    title: "Loss run",
    definition:
      "A report from the insurance company listing every claim on your policy, with what was paid and reserved. New carriers ask for it when quoting.",
  },
  valuationDate: {
    title: "Valuation date",
    definition:
      "The date the amounts in a report were taken. Paid and reserve change over time, so a report is only accurate as of this date.",
  },
  waitingOn: {
    title: "Waiting on",
    definition: "Who needs to act next on the claim: you, the agency or the insurance company.",
  },
  carrierUpdated: {
    title: "Last updated from carrier",
    definition:
      "When the agency last brought in the insurance company's figures (status, paid, reserve, adjuster). Amounts can change after this date.",
  },
};

/** The help for each Insights measure that is an amount (a count needs none). */
export const MEASURE_TERM: Partial<Record<InsightsMeasure, GlossaryTerm>> = {
  [INSIGHTS_MEASURE.incurred]: "incurred",
  [INSIGHTS_MEASURE.paid]: "paid",
};

export interface GlossaryEntry {
  title: string;
  /** The lines shown in the tooltip, in order. */
  lines: { label?: string; text: string }[];
}

/** A status's tooltip: meaning, typical next step and timing. */
export function statusGlossaryEntry(status: ClaimStatus): GlossaryEntry {
  const help = STATUS_HELP[status];
  return {
    title: CLAIM_STATUS_LABELS[status],
    lines: [
      { text: help.meaning },
      { label: "Next step", text: help.nextStep },
      { label: "Typical timing", text: help.timing },
    ],
  };
}

/** A term's tooltip. */
export function termGlossaryEntry(term: GlossaryTerm): GlossaryEntry {
  const help = TERM_HELP[term];
  return { title: help.title, lines: [{ text: help.definition }] };
}

/** The whole entry as one sentence block, for aria-descriptions and title text. */
export function glossaryPlainText(entry: GlossaryEntry): string {
  return entry.lines.map((l) => (l.label ? `${l.label}: ${l.text}` : l.text)).join(" ");
}
