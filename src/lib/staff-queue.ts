// Staff work queue on /admin/queue (fix 52): every claim, across all clients,
// that needs something from the agency. Pure rules over rows the server loaded
// with the caller's own token (staff-queue.functions.ts), so RLS still decides
// what is visible; the server function also requires the agency_admin role.
//
// One row per claim, carrying every reason it is on the queue, so a claim that
// is waiting on the agency and has a failed notification shows up once with
// both reasons instead of twice. Its age is that of its oldest reason.
//
// The follow-up, claim-number and no-update rules are the ones Home's "Needs
// your attention" uses (attention-queue.ts), run through buildAttentionQueue
// itself so the two lists can't drift apart. Document requests are left out:
// those wait on the client, not the agency.

import {
  ATTENTION_THRESHOLDS,
  buildAttentionQueue,
  type AttentionContactEmail,
  type AttentionKind,
} from "@/lib/attention-queue";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";
import { OUTBOX_STATUS } from "@/lib/claim-submission";
import {
  claimWaitingOn,
  daysSince,
  lastUpdateAt,
  WAITING_ON,
  type WaitingOn,
} from "@/lib/waiting-on";

export { ATTENTION_THRESHOLDS as STAFF_QUEUE_THRESHOLDS };

export const STAFF_QUEUE_REASONS = [
  "waiting_on_agency",
  "notification_failed",
  "follow_up",
  "awaiting_claim_number",
  "no_update",
] as const;

export type StaffQueueReasonKind = (typeof STAFF_QUEUE_REASONS)[number];

/** Filter labels; each reason on a row has its own, more specific text. */
export const STAFF_QUEUE_REASON_LABELS: Record<StaffQueueReasonKind, string> = {
  waiting_on_agency: "Waiting on agency",
  notification_failed: "Notification failed",
  follow_up: "Follow-up due",
  awaiting_claim_number: "No carrier claim #",
  no_update: "No recent activity",
};

export function isStaffQueueReason(value: unknown): value is StaffQueueReasonKind {
  return typeof value === "string" && (STAFF_QUEUE_REASONS as readonly string[]).includes(value);
}

// The attention rules the staff queue takes over, by their kind there.
const FROM_ATTENTION: Partial<Record<AttentionKind, StaffQueueReasonKind>> = {
  follow_up: "follow_up",
  awaiting_claim_number: "awaiting_claim_number",
  no_update: "no_update",
};

export interface StaffQueueClaim {
  id: string;
  claim_number: string | null;
  claim_type: string;
  client_id: string;
  client_name: string;
  status: ClaimStatus;
  waiting_on: WaitingOn | null;
  assigned_to: string | null;
  last_activity_at: string | null;
  created_at: string;
}

export interface StaffQueueOutboxRow {
  id: string;
  claim_id: string;
  kind: string;
  status: string;
  created_at: string;
}

export interface StaffQueueInput {
  claims: StaffQueueClaim[];
  contactEmails: AttentionContactEmail[];
  outbox: StaffQueueOutboxRow[];
}

export interface StaffQueueReason {
  kind: StaffQueueReasonKind;
  /** "Follow-up due: Adjuster", "Notification failed (email)". */
  label: string;
  /** When the thing being waited on started. */
  since: string;
  ageDays: number;
}

export interface StaffQueueItem {
  claimId: string;
  claimNumber: string | null;
  claimType: string;
  clientId: string;
  clientName: string;
  status: ClaimStatus;
  assignedTo: string | null;
  /** Oldest first. */
  reasons: StaffQueueReason[];
  /** The oldest reason's age and start. */
  ageDays: number;
  since: string;
}

const OUTBOX_KIND_LABELS: Record<string, string> = {
  email: "agency email",
  webhook: "webhook",
};

function compareReasons(a: StaffQueueReason, b: StaffQueueReason): number {
  return (
    b.ageDays - a.ageDays ||
    Date.parse(a.since) - Date.parse(b.since) ||
    STAFF_QUEUE_REASONS.indexOf(a.kind) - STAFF_QUEUE_REASONS.indexOf(b.kind)
  );
}

/**
 * Builds the queue: one item per open claim with at least one reason. Closed
 * claims never appear. Sorted oldest first (see sortStaffQueue).
 */
export function buildStaffQueue(input: StaffQueueInput, now: Date): StaffQueueItem[] {
  const claims = new Map(
    input.claims.filter((c) => c.status !== CLAIM_STATUS.closed).map((c) => [c.id, c]),
  );
  const reasons = new Map<string, StaffQueueReason[]>();
  const add = (claimId: string, reason: StaffQueueReason) => {
    const list = reasons.get(claimId);
    if (list) list.push(reason);
    else reasons.set(claimId, [reason]);
  };

  // The agency has the ball.
  for (const claim of claims.values()) {
    if (claimWaitingOn(claim) !== WAITING_ON.agency) continue;
    const since = lastUpdateAt(claim);
    const age = daysSince(since, now);
    if (!since || age === null) continue;
    add(claim.id, {
      kind: "waiting_on_agency",
      label: STAFF_QUEUE_REASON_LABELS.waiting_on_agency,
      since,
      ageDays: age,
    });
  }

  // A claim notification that gave up after its retries (retry it on /admin).
  for (const row of input.outbox) {
    if (row.status !== OUTBOX_STATUS.failed || !claims.has(row.claim_id)) continue;
    const age = daysSince(row.created_at, now);
    if (age === null) continue;
    const kind = OUTBOX_KIND_LABELS[row.kind];
    add(row.claim_id, {
      kind: "notification_failed",
      label: kind ? `Notification failed (${kind})` : "Notification failed",
      since: row.created_at,
      ageDays: age,
    });
  }

  // Follow-ups due, no carrier claim number, no recent activity: Home's rules.
  const attention = buildAttentionQueue(
    {
      claims: [...claims.values()].map((c) => ({
        id: c.id,
        claim_number: c.claim_number,
        claim_type: c.claim_type,
        client_name: c.client_name,
        status: c.status,
        last_activity_at: c.last_activity_at,
        created_at: c.created_at,
      })),
      documentRequests: [],
      contactEmails: input.contactEmails,
    },
    now,
  );
  for (const item of attention) {
    const kind = FROM_ATTENTION[item.kind];
    if (!kind) continue;
    add(item.claimId, { kind, label: item.reason, since: item.since, ageDays: item.ageDays });
  }

  const items: StaffQueueItem[] = [];
  for (const [claimId, list] of reasons) {
    const claim = claims.get(claimId)!;
    list.sort(compareReasons);
    items.push({
      claimId,
      claimNumber: claim.claim_number?.trim() || null,
      claimType: claim.claim_type,
      clientId: claim.client_id,
      clientName: claim.client_name,
      status: claim.status,
      assignedTo: claim.assigned_to,
      reasons: list,
      ageDays: list[0].ageDays,
      since: list[0].since,
    });
  }
  return sortStaffQueue(items, "oldest");
}

// --- Filters and sort, kept in the URL like /claims ---------------------------

/** assignee=unassigned picks claims nobody is assigned to. */
export const UNASSIGNED = "unassigned";

export const STAFF_QUEUE_SORTS = ["oldest", "newest"] as const;
export type StaffQueueSort = (typeof STAFF_QUEUE_SORTS)[number];

export interface StaffQueueSearch {
  client?: string;
  reason?: StaffQueueReasonKind;
  /** A staff user id, or UNASSIGNED. */
  assignee?: string;
  /** Default "oldest". */
  sort?: StaffQueueSort;
}

const ID_RE = /^[0-9a-f-]{36}$/i;

function filterId(value: unknown): string | undefined {
  return typeof value === "string" && ID_RE.test(value) ? value : undefined;
}

export function parseStaffQueueSearch(search: Record<string, unknown>): StaffQueueSearch {
  const result: StaffQueueSearch = {};
  const client = filterId(search.client);
  if (client) result.client = client;
  if (isStaffQueueReason(search.reason)) result.reason = search.reason;
  const assignee = search.assignee === UNASSIGNED ? UNASSIGNED : filterId(search.assignee);
  if (assignee) result.assignee = assignee;
  if (search.sort === "newest") result.sort = "newest";
  return result;
}

export function filterStaffQueue(
  items: readonly StaffQueueItem[],
  filters: StaffQueueSearch,
): StaffQueueItem[] {
  return items.filter(
    (item) =>
      (!filters.client || item.clientId === filters.client) &&
      (!filters.reason || item.reasons.some((r) => r.kind === filters.reason)) &&
      (!filters.assignee ||
        (filters.assignee === UNASSIGNED
          ? item.assignedTo === null
          : item.assignedTo === filters.assignee)),
  );
}

/** Oldest first by default; ties by claim number. Returns a new array. */
export function sortStaffQueue(
  items: readonly StaffQueueItem[],
  sort: StaffQueueSort = "oldest",
): StaffQueueItem[] {
  const sign = sort === "newest" ? -1 : 1;
  return [...items].sort(
    (a, b) =>
      sign * (b.ageDays - a.ageDays) ||
      sign * (Date.parse(a.since) - Date.parse(b.since)) ||
      (a.claimNumber ?? "").localeCompare(b.claimNumber ?? "", "en-US", { numeric: true }) ||
      a.claimId.localeCompare(b.claimId),
  );
}

/** The clients on the queue, A to Z, for the client filter. */
export function staffQueueClients(
  items: readonly StaffQueueItem[],
): { id: string; name: string }[] {
  const byId = new Map<string, string>();
  for (const item of items) byId.set(item.clientId, item.clientName || "Unnamed client");
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
