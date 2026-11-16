import { describe, expect, it } from "vitest";
import { CLAIM_STATUS } from "@/lib/claim-status";
import { OUTBOX_STATUS } from "@/lib/claim-submission";
import {
  buildStaffQueue,
  filterStaffQueue,
  parseStaffQueueSearch,
  sortStaffQueue,
  staffQueueClients,
  UNASSIGNED,
  type StaffQueueClaim,
  type StaffQueueInput,
  type StaffQueueItem,
} from "@/lib/staff-queue";
import { WAITING_ON } from "@/lib/waiting-on";

const now = new Date("2026-11-16T15:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

const CLIENT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const CLIENT_B = "bbbbbbbb-0000-0000-0000-000000000002";
const STAFF_1 = "11111111-1111-1111-1111-111111111111";

// A claim with nothing pending: with the carrier, numbered, touched yesterday.
const claim = (fields: Partial<StaffQueueClaim> & { id: string }): StaffQueueClaim => ({
  claim_number: "CN-1",
  claim_type: "General Liability",
  client_id: CLIENT_A,
  client_name: "Acme Co",
  status: CLAIM_STATUS.open,
  waiting_on: WAITING_ON.carrier,
  assigned_to: null,
  last_activity_at: daysAgo(1),
  created_at: daysAgo(30),
  ...fields,
});

const input = (fields: Partial<StaffQueueInput>): StaffQueueInput => ({
  claims: [],
  contactEmails: [],
  outbox: [],
  ...fields,
});

const kinds = (items: StaffQueueItem[]) =>
  items.map((i) => [i.claimId, i.reasons.map((r) => r.kind)]);

describe("buildStaffQueue rules", () => {
  it("is empty when nothing needs the agency", () => {
    expect(buildStaffQueue(input({ claims: [claim({ id: "a" })] }), now)).toEqual([]);
  });

  it("lists claims waiting on the agency, aged from the last update", () => {
    const items = buildStaffQueue(
      input({
        claims: [
          claim({ id: "a", waiting_on: WAITING_ON.agency, last_activity_at: daysAgo(4) }),
          claim({ id: "b", waiting_on: WAITING_ON.client }),
        ],
      }),
      now,
    );
    expect(kinds(items)).toEqual([["a", ["waiting_on_agency"]]]);
    expect(items[0].reasons[0].label).toBe("Waiting on agency");
    expect(items[0].ageDays).toBe(4);
  });

  it("lists failed notifications only", () => {
    const items = buildStaffQueue(
      input({
        claims: [claim({ id: "a" }), claim({ id: "b" })],
        outbox: [
          {
            id: "o1",
            claim_id: "a",
            kind: "email",
            status: OUTBOX_STATUS.failed,
            created_at: daysAgo(2),
          },
          {
            id: "o2",
            claim_id: "b",
            kind: "email",
            status: OUTBOX_STATUS.sent,
            created_at: daysAgo(2),
          },
          {
            id: "o3",
            claim_id: "b",
            kind: "webhook",
            status: OUTBOX_STATUS.pending,
            created_at: daysAgo(2),
          },
        ],
      }),
      now,
    );
    expect(kinds(items)).toEqual([["a", ["notification_failed"]]]);
    expect(items[0].reasons[0].label).toBe("Notification failed (agency email)");
  });

  it("lists follow-ups unanswered for 7+ days, using the newest email per contact", () => {
    const email = (claimId: string, contactId: string, sent: number, replied: number | null) => ({
      claim_id: claimId,
      claim_contact_id: contactId,
      sent_at: daysAgo(sent),
      replied_at: replied === null ? null : daysAgo(replied),
      row_key: "adjuster",
    });
    const items = buildStaffQueue(
      input({
        claims: [claim({ id: "a" }), claim({ id: "b" }), claim({ id: "c" })],
        contactEmails: [
          email("a", "ca", 8, null),
          email("b", "cb", 6, null), // not due yet
          email("c", "cc", 20, null),
          email("c", "cc", 9, 2), // newer email answered
        ],
      }),
      now,
    );
    expect(kinds(items)).toEqual([["a", ["follow_up"]]]);
    expect(items[0].reasons[0].label).toBe("Follow-up due: Adjuster");
  });

  it("lists submitted claims with no carrier claim # after 3 days", () => {
    const items = buildStaffQueue(
      input({
        claims: [
          claim({
            id: "a",
            status: CLAIM_STATUS.submitted,
            claim_number: null,
            created_at: daysAgo(3),
          }),
          claim({
            id: "b",
            status: CLAIM_STATUS.submitted,
            claim_number: " ",
            created_at: daysAgo(2),
          }),
          claim({
            id: "c",
            status: CLAIM_STATUS.submitted,
            claim_number: "X-1",
            created_at: daysAgo(9),
          }),
        ],
      }),
      now,
    );
    expect(kinds(items)).toEqual([["a", ["awaiting_claim_number"]]]);
  });

  it("lists claims with no activity in 14+ days", () => {
    const items = buildStaffQueue(
      input({
        claims: [
          claim({ id: "a", last_activity_at: daysAgo(14) }),
          claim({ id: "b", last_activity_at: daysAgo(13) }),
          claim({ id: "c", last_activity_at: null, created_at: daysAgo(40) }),
        ],
      }),
      now,
    );
    expect(kinds(items)).toEqual([
      ["c", ["no_update"]],
      ["a", ["no_update"]],
    ]);
  });

  it("never lists closed claims, whatever else is true", () => {
    const items = buildStaffQueue(
      input({
        claims: [
          claim({
            id: "a",
            status: CLAIM_STATUS.closed,
            waiting_on: WAITING_ON.agency,
            last_activity_at: daysAgo(100),
          }),
        ],
        outbox: [
          {
            id: "o1",
            claim_id: "a",
            kind: "email",
            status: OUTBOX_STATUS.failed,
            created_at: daysAgo(2),
          },
        ],
        contactEmails: [
          {
            claim_id: "a",
            claim_contact_id: "c",
            sent_at: daysAgo(30),
            replied_at: null,
            row_key: null,
          },
        ],
      }),
      now,
    );
    expect(items).toEqual([]);
  });

  it("puts every reason for a claim on one row, aged by the oldest", () => {
    const items = buildStaffQueue(
      input({
        claims: [
          claim({
            id: "a",
            status: CLAIM_STATUS.submitted,
            claim_number: null,
            waiting_on: WAITING_ON.agency,
            last_activity_at: daysAgo(2),
            created_at: daysAgo(10),
          }),
        ],
        outbox: [
          {
            id: "o1",
            claim_id: "a",
            kind: "webhook",
            status: OUTBOX_STATUS.failed,
            created_at: daysAgo(5),
          },
        ],
      }),
      now,
    );
    expect(items).toHaveLength(1);
    expect(items[0].reasons.map((r) => r.kind)).toEqual([
      "awaiting_claim_number",
      "notification_failed",
      "waiting_on_agency",
    ]);
    expect(items[0].ageDays).toBe(10);
    expect(items[0].since).toBe(daysAgo(10));
  });

  it("ignores rows for claims it doesn't have", () => {
    const items = buildStaffQueue(
      input({
        claims: [],
        outbox: [
          {
            id: "o1",
            claim_id: "x",
            kind: "email",
            status: OUTBOX_STATUS.failed,
            created_at: daysAgo(2),
          },
        ],
      }),
      now,
    );
    expect(items).toEqual([]);
  });

  it("sorts oldest first and carries client and assignee", () => {
    const items = buildStaffQueue(
      input({
        claims: [
          claim({ id: "a", waiting_on: WAITING_ON.agency, last_activity_at: daysAgo(1) }),
          claim({
            id: "b",
            waiting_on: WAITING_ON.agency,
            last_activity_at: daysAgo(6),
            client_id: CLIENT_B,
            client_name: "Bravo LLC",
            assigned_to: STAFF_1,
          }),
        ],
      }),
      now,
    );
    expect(items.map((i) => i.claimId)).toEqual(["b", "a"]);
    expect(items[0]).toMatchObject({
      clientId: CLIENT_B,
      clientName: "Bravo LLC",
      assignedTo: STAFF_1,
    });
  });
});

describe("staff queue filters", () => {
  const items = buildStaffQueue(
    input({
      claims: [
        claim({ id: "a", waiting_on: WAITING_ON.agency, last_activity_at: daysAgo(3) }),
        claim({
          id: "b",
          client_id: CLIENT_B,
          client_name: "Bravo LLC",
          assigned_to: STAFF_1,
          last_activity_at: daysAgo(20),
        }),
        claim({
          id: "c",
          client_id: CLIENT_B,
          client_name: "Bravo LLC",
          waiting_on: WAITING_ON.agency,
          last_activity_at: daysAgo(15),
        }),
      ],
    }),
    now,
  );

  it("filters by client", () => {
    expect(filterStaffQueue(items, { client: CLIENT_B }).map((i) => i.claimId)).toEqual(["b", "c"]);
  });

  it("filters by reason, matching any of a claim's reasons", () => {
    expect(filterStaffQueue(items, { reason: "waiting_on_agency" }).map((i) => i.claimId)).toEqual([
      "c",
      "a",
    ]);
    expect(filterStaffQueue(items, { reason: "no_update" }).map((i) => i.claimId)).toEqual([
      "b",
      "c",
    ]);
  });

  it("filters by assignee, including unassigned", () => {
    expect(filterStaffQueue(items, { assignee: STAFF_1 }).map((i) => i.claimId)).toEqual(["b"]);
    expect(filterStaffQueue(items, { assignee: UNASSIGNED }).map((i) => i.claimId)).toEqual([
      "c",
      "a",
    ]);
  });

  it("combines filters", () => {
    expect(
      filterStaffQueue(items, { client: CLIENT_B, reason: "waiting_on_agency" }).map(
        (i) => i.claimId,
      ),
    ).toEqual(["c"]);
  });

  it("sorts newest first on request", () => {
    expect(sortStaffQueue(items, "newest").map((i) => i.claimId)).toEqual(["a", "c", "b"]);
    expect(sortStaffQueue(items).map((i) => i.claimId)).toEqual(["b", "c", "a"]);
  });

  it("lists the clients on the queue A to Z", () => {
    expect(staffQueueClients(items)).toEqual([
      { id: CLIENT_A, name: "Acme Co" },
      { id: CLIENT_B, name: "Bravo LLC" },
    ]);
  });
});

describe("parseStaffQueueSearch", () => {
  it("keeps valid filters and drops the rest", () => {
    expect(
      parseStaffQueueSearch({
        client: CLIENT_A,
        reason: "follow_up",
        assignee: UNASSIGNED,
        sort: "newest",
      }),
    ).toEqual({ client: CLIENT_A, reason: "follow_up", assignee: UNASSIGNED, sort: "newest" });
    expect(
      parseStaffQueueSearch({ client: "nope", reason: "bogus", assignee: "x", sort: "oldest" }),
    ).toEqual({});
    expect(parseStaffQueueSearch({ assignee: STAFF_1 })).toEqual({ assignee: STAFF_1 });
  });
});
