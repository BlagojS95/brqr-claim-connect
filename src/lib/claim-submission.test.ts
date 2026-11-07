import { describe, expect, it } from "vitest";
import {
  backoffMs,
  deliverPendingRows,
  MAX_NOTIFICATION_ATTEMPTS,
  submitClaimCore,
  type ClaimInsert,
  type DocumentInsert,
  type OutboxPatch,
  type OutboxRow,
  type SubmitClaimDeps,
  type SubmitClaimInput,
} from "@/lib/claim-submission";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const OTHER_CLIENT = "22222222-2222-4222-8222-222222222222";
const CLAIM = "33333333-3333-4333-8333-333333333333";
const LINE = "44444444-4444-4444-8444-444444444444";
const POLICY = "55555555-5555-4555-8555-555555555555";

// In-memory stand-in for the claims, documents and notification_outbox tables.
function fakeDb(ownClientId = CLIENT) {
  const claims: ClaimInsert[] = [];
  const documents: DocumentInsert[] = [];
  const outbox: (OutboxRow & { last_error: string | null })[] = [];
  const deps: SubmitClaimDeps = {
    today: () => "2026-11-07",
    async assertCanSubmitFor(clientId) {
      if (clientId !== ownClientId)
        throw new Error("You can only report claims for your own account");
    },
    getLine: async (id) => (id === LINE ? { id, name: "General Liability" } : null),
    getPolicy: async (id, clientId) =>
      id === POLICY && clientId === CLIENT
        ? { id, policy_number: "GL-100", carrier: "Acme" }
        : null,
    signDocumentUrl: async (path) => `https://signed.example/${path}`,
    async insertClaim(row) {
      claims.push(row);
      return { id: row.id };
    },
    async insertDocuments(rows) {
      documents.push(...rows);
    },
    async insertOutbox(rows) {
      for (const r of rows) {
        outbox.push({
          id: `${r.kind}-row`,
          ...r,
          status: "pending",
          attempts: 0,
          last_error: null,
        });
      }
    },
    async deleteClaim(id) {
      const i = claims.findIndex((c) => c.id === id);
      if (i !== -1) claims.splice(i, 1);
    },
  };
  const updateOutbox = async (id: string, patch: OutboxPatch) => {
    Object.assign(outbox.find((r) => r.id === id)!, patch);
  };
  return { claims, documents, outbox, deps, updateOutbox };
}

const input = (overrides: Partial<SubmitClaimInput> = {}): SubmitClaimInput => ({
  claimId: CLAIM,
  clientId: CLIENT,
  lineOfBusinessId: LINE,
  policyId: POLICY,
  isNotice: false,
  dateOfLoss: "2026-11-01",
  claimantName: "Jane Doe",
  description: "Slip and fall in the lobby",
  documents: [{ path: `${CLIENT}/${CLAIM}/1-photo.jpg`, fileName: "photo.jpg" }],
  ...overrides,
});

describe("submitClaimCore", () => {
  it("saves the claim and marks the email outbox row failed when the email sender throws", async () => {
    const db = fakeDb();
    const sleeps: number[] = [];

    const { claimId } = await submitClaimCore(input(), db.deps);
    expect(claimId).toBe(CLAIM);

    const results = await deliverPendingRows(db.outbox, {
      updateOutbox: db.updateOutbox,
      send: {
        email: async () => {
          throw new Error("Resend request failed: 500");
        },
        webhook: async () => undefined,
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    // The claim and its document survive the email outage.
    expect(db.claims).toHaveLength(1);
    expect(db.claims[0]).toMatchObject({
      id: CLAIM,
      client_id: CLIENT,
      claim_type: "General Liability",
      policy_number: "GL-100",
      carrier: "Acme",
      status: "Open",
      date_reported: "2026-11-07",
    });
    expect(db.documents).toEqual([
      {
        claim_id: CLAIM,
        client_id: CLIENT,
        file_name: "photo.jpg",
        file_url: `https://signed.example/${CLIENT}/${CLAIM}/1-photo.jpg`,
      },
    ]);

    const email = db.outbox.find((r) => r.kind === "email")!;
    expect(email).toMatchObject({
      status: "failed",
      attempts: MAX_NOTIFICATION_ATTEMPTS,
      last_error: "Resend request failed: 500",
    });
    expect(db.outbox.find((r) => r.kind === "webhook")).toMatchObject({
      status: "sent",
      attempts: 1,
    });
    expect(results).toContainEqual({ id: "email-row", kind: "email", status: "failed" });
    // Backoff between the 5 email attempts.
    expect(sleeps).toEqual([500, 1000, 2000, 4000]);
  });

  it("records a success after a transient failure", async () => {
    const db = fakeDb();
    await submitClaimCore(input({ documents: [] }), db.deps);
    let calls = 0;
    await deliverPendingRows(db.outbox, {
      updateOutbox: db.updateOutbox,
      send: {
        email: async () => {
          if (++calls < 3) throw new Error("timeout");
        },
        webhook: async () => undefined,
      },
      sleep: async () => undefined,
    });
    expect(db.outbox.find((r) => r.kind === "email")).toMatchObject({
      status: "sent",
      attempts: 3,
      last_error: null,
    });
  });

  it("rejects a client submitting for someone else's client_id", async () => {
    const db = fakeDb();
    await expect(
      submitClaimCore(input({ clientId: OTHER_CLIENT, policyId: null, documents: [] }), db.deps),
    ).rejects.toThrow("your own account");
    expect(db.claims).toHaveLength(0);
    expect(db.outbox).toHaveLength(0);
  });

  it("rejects document paths outside the claim's folder", async () => {
    const db = fakeDb();
    await expect(
      submitClaimCore(
        input({ documents: [{ path: `${OTHER_CLIENT}/${CLAIM}/x.pdf`, fileName: "x.pdf" }] }),
        db.deps,
      ),
    ).rejects.toThrow("Invalid document path");
    expect(db.claims).toHaveLength(0);
  });

  it("removes the claim again if the outbox rows can't be written", async () => {
    const db = fakeDb();
    db.deps.insertOutbox = async () => {
      throw new Error("Couldn't queue notifications");
    };
    await expect(submitClaimCore(input(), db.deps)).rejects.toThrow("queue notifications");
    expect(db.claims).toHaveLength(0);
  });

  it("uses the agreed backoff schedule", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([500, 1000, 2000, 4000]);
  });
});
