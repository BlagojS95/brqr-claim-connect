import { describe, expect, it } from "vitest";
import {
  attentionAgeLabel,
  buildAttentionQueue,
  type AttentionClaim,
  type AttentionInput,
} from "@/lib/attention-queue";
import { CLAIM_STATUS } from "@/lib/claim-status";

const now = new Date("2026-11-09T15:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

const claim = (fields: Partial<AttentionClaim> & { id: string }): AttentionClaim => ({
  claim_number: "CN-1",
  claim_type: "General Liability",
  client_name: "Acme Co",
  status: CLAIM_STATUS.open,
  last_activity_at: daysAgo(1),
  created_at: daysAgo(30),
  ...fields,
});

const input = (fields: Partial<AttentionInput>): AttentionInput => ({
  claims: [],
  documentRequests: [],
  contactEmails: [],
  ...fields,
});

const reasons = (i: AttentionInput) => buildAttentionQueue(i, now).map((x) => x.reason);

describe("buildAttentionQueue", () => {
  it("is empty when nothing is waiting", () => {
    expect(buildAttentionQueue(input({ claims: [claim({ id: "a" })] }), now)).toEqual([]);
  });

  it("lists open document requests, whatever their age", () => {
    const items = buildAttentionQueue(
      input({
        claims: [claim({ id: "a" })],
        documentRequests: [
          {
            id: "r1",
            claim_id: "a",
            name: " W-2 ",
            requested_at: daysAgo(0),
            fulfilled_at: null,
          },
          {
            id: "r2",
            claim_id: "a",
            name: "Photos",
            requested_at: daysAgo(5),
            fulfilled_at: daysAgo(1),
          },
        ],
      }),
      now,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "document_request",
      claimId: "a",
      claimNumber: "CN-1",
      clientName: "Acme Co",
      reason: "Document requested: W-2",
      ageDays: 0,
    });
  });

  it("flags claims with no update in 14 days, using created_at when there is no activity", () => {
    expect(
      reasons(
        input({
          claims: [
            claim({ id: "fresh", last_activity_at: daysAgo(13) }),
            claim({ id: "stale", last_activity_at: daysAgo(14) }),
            claim({ id: "never", last_activity_at: null, created_at: daysAgo(20) }),
          ],
        }),
      ),
    ).toEqual(["No update in 20 days", "No update in 14 days"]);
  });

  it("flags submitted claims with no claim number after 3 days, instead of 'No update'", () => {
    const items = buildAttentionQueue(
      input({
        claims: [
          claim({
            id: "old",
            status: CLAIM_STATUS.submitted,
            claim_number: null,
            created_at: daysAgo(20),
            last_activity_at: daysAgo(20),
          }),
          claim({
            id: "new",
            status: CLAIM_STATUS.submitted,
            claim_number: "  ",
            created_at: daysAgo(2),
          }),
          claim({ id: "numbered", status: CLAIM_STATUS.submitted, created_at: daysAgo(9) }),
        ],
      }),
      now,
    );
    expect(items.map((i) => [i.claimId, i.reason, i.claimNumber])).toEqual([
      ["old", "Awaiting carrier claim # for 20 days", null],
    ]);
  });

  it("flags follow-ups when the newest email to a contact is 7+ days old and unanswered", () => {
    const items = buildAttentionQueue(
      input({
        claims: [claim({ id: "a" })],
        contactEmails: [
          // Adjuster: newest email is 8 days old, no reply -> due.
          {
            claim_id: "a",
            claim_contact_id: "adj",
            sent_at: daysAgo(20),
            replied_at: daysAgo(18),
            row_key: "adjuster",
          },
          {
            claim_id: "a",
            claim_contact_id: "adj",
            sent_at: daysAgo(8),
            replied_at: null,
            row_key: "adjuster",
          },
          // Attorney: old unanswered email, but a newer one was answered -> not due.
          {
            claim_id: "a",
            claim_contact_id: "att",
            sent_at: daysAgo(30),
            replied_at: null,
            row_key: "attorney",
          },
          {
            claim_id: "a",
            claim_contact_id: "att",
            sent_at: daysAgo(10),
            replied_at: daysAgo(9),
            row_key: "attorney",
          },
          // Other: only 6 days -> not yet.
          {
            claim_id: "a",
            claim_contact_id: "oth",
            sent_at: daysAgo(6),
            replied_at: null,
            row_key: "other_1",
          },
          // Unknown row key still shows, without a label.
          {
            claim_id: "a",
            claim_contact_id: "x",
            sent_at: daysAgo(7),
            replied_at: null,
            row_key: null,
          },
        ],
      }),
      now,
    );
    expect(items.map((i) => [i.kind, i.reason, i.ageDays])).toEqual([
      ["follow_up", "Follow-up due: Adjuster", 8],
      ["follow_up", "Follow-up due", 7],
    ]);
  });

  it("leaves out closed claims and rows for claims the caller can't see", () => {
    expect(
      reasons(
        input({
          claims: [
            claim({ id: "closed", status: CLAIM_STATUS.closed, last_activity_at: daysAgo(90) }),
          ],
          documentRequests: [
            {
              id: "r",
              claim_id: "closed",
              name: "W-2",
              requested_at: daysAgo(3),
              fulfilled_at: null,
            },
            {
              id: "r2",
              claim_id: "other-client",
              name: "W-2",
              requested_at: daysAgo(3),
              fulfilled_at: null,
            },
          ],
          contactEmails: [
            {
              claim_id: "closed",
              claim_contact_id: "c",
              sent_at: daysAgo(30),
              replied_at: null,
              row_key: "adjuster",
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("sorts oldest first, then by kind", () => {
    const items = buildAttentionQueue(
      input({
        claims: [
          claim({ id: "a", claim_number: "A", last_activity_at: daysAgo(15) }),
          claim({ id: "b", claim_number: "B", last_activity_at: daysAgo(40) }),
          claim({ id: "c", claim_number: "C" }),
        ],
        documentRequests: [
          { id: "r", claim_id: "c", name: "Invoice", requested_at: daysAgo(2), fulfilled_at: null },
          {
            id: "r2",
            claim_id: "a",
            name: "Photos",
            requested_at: daysAgo(15),
            fulfilled_at: null,
          },
        ],
      }),
      now,
    );
    expect(items.map((i) => `${i.claimNumber} ${i.reason}`)).toEqual([
      "B No update in 40 days",
      "A Document requested: Photos",
      "A No update in 15 days",
      "C Document requested: Invoice",
    ]);
  });
});

describe("attentionAgeLabel", () => {
  it("reads naturally", () => {
    expect(attentionAgeLabel(0)).toBe("Today");
    expect(attentionAgeLabel(1)).toBe("1 day ago");
    expect(attentionAgeLabel(9)).toBe("9 days ago");
  });
});
