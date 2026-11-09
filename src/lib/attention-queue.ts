// "Needs your attention" on Home (fix 29). Pure rules over rows the server has
// already loaded with the caller's own token (attention.functions.ts), so RLS
// decides whose claims these are; nothing here knows about roles.

import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";
import { CONTACT_ROW_LABELS } from "@/lib/claim-contacts";
import { daysSince, lastUpdateAt } from "@/lib/waiting-on";

/** Days before each rule fires. */
export const ATTENTION_THRESHOLDS = {
  /** No activity on a claim that isn't closed. */
  noUpdateDays: 14,
  /** Submitted to the carrier but still no claim number. */
  claimNumberDays: 3,
  /** Newest email to a contact unanswered. */
  followUpDays: 7,
} as const;

/** How many items Home shows before "Show all N". */
export const ATTENTION_PREVIEW_COUNT = 8;

export const ATTENTION_KINDS = [
  "document_request",
  "awaiting_claim_number",
  "follow_up",
  "no_update",
] as const;

export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export interface AttentionClaim {
  id: string;
  claim_number: string | null;
  claim_type: string;
  client_name: string;
  status: ClaimStatus;
  last_activity_at: string | null;
  created_at: string;
}

export interface AttentionDocumentRequest {
  id: string;
  claim_id: string;
  name: string;
  requested_at: string;
  fulfilled_at: string | null;
}

export interface AttentionContactEmail {
  claim_id: string;
  claim_contact_id: string;
  sent_at: string;
  replied_at: string | null;
  /** claim_contacts.row_key, for the contact's label. */
  row_key: string | null;
}

export interface AttentionInput {
  claims: AttentionClaim[];
  documentRequests: AttentionDocumentRequest[];
  contactEmails: AttentionContactEmail[];
}

export interface AttentionItem {
  /** Stable React key. */
  key: string;
  kind: AttentionKind;
  claimId: string;
  claimNumber: string | null;
  claimType: string;
  clientName: string;
  reason: string;
  /** When the thing being waited on started. */
  since: string;
  ageDays: number;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Builds the queue. Closed claims never appear. A claim can have several items
 * (two open document requests, say), but "No update" is left out when the
 * claim already shows "Awaiting carrier claim #", which says the same thing.
 * Sorted oldest first; ties follow ATTENTION_KINDS order, then claim number.
 */
export function buildAttentionQueue(input: AttentionInput, now: Date): AttentionItem[] {
  const claims = new Map(
    input.claims.filter((c) => c.status !== CLAIM_STATUS.closed).map((c) => [c.id, c]),
  );
  const items: AttentionItem[] = [];

  const add = (
    claim: AttentionClaim,
    kind: AttentionKind,
    ref: string,
    reason: string,
    since: string,
    ageDays: number,
  ) =>
    items.push({
      key: `${kind}:${claim.id}:${ref}`,
      kind,
      claimId: claim.id,
      claimNumber: claim.claim_number?.trim() || null,
      claimType: claim.claim_type,
      clientName: claim.client_name,
      reason,
      since,
      ageDays,
    });

  // (a) Documents the agency asked for and hasn't received.
  for (const request of input.documentRequests) {
    if (request.fulfilled_at) continue;
    const claim = claims.get(request.claim_id);
    const age = daysSince(request.requested_at, now);
    if (!claim || age === null) continue;
    add(
      claim,
      "document_request",
      request.id,
      `Document requested: ${request.name.trim()}`,
      request.requested_at,
      age,
    );
  }

  // (c) Submitted, still no carrier claim number.
  const awaitingNumber = new Set<string>();
  for (const claim of claims.values()) {
    if (claim.status !== CLAIM_STATUS.submitted || claim.claim_number?.trim()) continue;
    const age = daysSince(claim.created_at, now);
    if (age === null || age < ATTENTION_THRESHOLDS.claimNumberDays) continue;
    awaitingNumber.add(claim.id);
    add(
      claim,
      "awaiting_claim_number",
      "",
      `Awaiting carrier claim # for ${plural(age, "day")}`,
      claim.created_at,
      age,
    );
  }

  // (b) Nothing has happened on the claim for a while.
  for (const claim of claims.values()) {
    if (awaitingNumber.has(claim.id)) continue;
    const since = lastUpdateAt(claim);
    const age = daysSince(since, now);
    if (!since || age === null || age < ATTENTION_THRESHOLDS.noUpdateDays) continue;
    add(claim, "no_update", "", `No update in ${plural(age, "day")}`, since, age);
  }

  // (d) The newest email to a contact has had no reply for a week.
  const newestByContact = new Map<string, AttentionContactEmail>();
  for (const email of input.contactEmails) {
    const current = newestByContact.get(email.claim_contact_id);
    if (!current || Date.parse(email.sent_at) > Date.parse(current.sent_at)) {
      newestByContact.set(email.claim_contact_id, email);
    }
  }
  for (const email of newestByContact.values()) {
    if (email.replied_at) continue;
    const claim = claims.get(email.claim_id);
    const age = daysSince(email.sent_at, now);
    if (!claim || age === null || age < ATTENTION_THRESHOLDS.followUpDays) continue;
    const label = email.row_key ? CONTACT_ROW_LABELS[email.row_key] : undefined;
    add(
      claim,
      "follow_up",
      email.claim_contact_id,
      label ? `Follow-up due: ${label}` : "Follow-up due",
      email.sent_at,
      age,
    );
  }

  return items.sort(
    (a, b) =>
      b.ageDays - a.ageDays ||
      Date.parse(a.since) - Date.parse(b.since) ||
      ATTENTION_KINDS.indexOf(a.kind) - ATTENTION_KINDS.indexOf(b.kind) ||
      (a.claimNumber ?? "").localeCompare(b.claimNumber ?? "", "en-US", { numeric: true }),
  );
}

/** "Today", "1 day ago", "12 days ago". */
export function attentionAgeLabel(days: number): string {
  if (days <= 0) return "Today";
  return `${plural(days, "day")} ago`;
}
