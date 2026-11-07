import { describe, expect, it } from "vitest";
import { LINE_OF_BUSINESS } from "@/lib/line-of-business";
import {
  backoffMs,
  claimRuleError,
  deliverPendingRows,
  lossDetailsFor,
  SubmitClaimSchema,
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
const WC_LINE = "66666666-6666-4666-8666-666666666666";
const AUTO_LINE = "77777777-7777-4777-8777-777777777777";

const LINES: Record<string, { id: string; name: string; code: string }> = {
  [LINE]: { id: LINE, name: "General Liability", code: "GL" },
  [WC_LINE]: { id: WC_LINE, name: "Workers Compensation", code: "WC" },
  [AUTO_LINE]: { id: AUTO_LINE, name: "Business Auto", code: "AUTO" },
};

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
    getLine: async (id) => LINES[id] ?? null,
    getPolicy: async (id, clientId) =>
      id === POLICY && clientId === CLIENT
        ? {
            id,
            policy_number: "GL-100",
            carrier: "Acme",
            effective_date: "2026-01-01",
            expiration_date: "2026-12-31",
            line_of_business_id: LINE,
          }
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
  thirdPartyContact: "jane@example.com",
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
      status: "submitted",
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

  it("queues only the email when the webhook is turned off", async () => {
    const db = fakeDb();
    db.deps.notificationKinds = () => ["email"];
    await submitClaimCore(input({ documents: [] }), db.deps);
    expect(db.outbox.map((r) => r.kind)).toEqual(["email"]);
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

describe("loss details by line of business", () => {
  const wc = (overrides: Partial<SubmitClaimInput> = {}) =>
    input({
      lineOfBusinessId: WC_LINE,
      policyId: null,
      documents: [],
      employeeName: "Sam Worker",
      employeeJobTitle: "Forklift operator",
      injuredBodyPart: "Lower back",
      dateReportedToEmployer: "2026-11-02",
      ...overrides,
    });

  it("saves the shared and Workers Compensation fields", async () => {
    const db = fakeDb();
    await submitClaimCore(
      wc({
        timeOfLoss: "14:30",
        lossLocation: " Warehouse 3 ",
        reporterName: "Pat Manager",
        reporterEmail: "pat@example.com",
        injuries: true,
      }),
      db.deps,
    );
    expect(db.claims[0]).toMatchObject({
      time_of_loss: "14:30",
      loss_location: "Warehouse 3",
      reporter_name: "Pat Manager",
      reporter_email: "pat@example.com",
      reporter_phone: null,
      injuries: true,
      employee_name: "Sam Worker",
      employee_job_title: "Forklift operator",
      injured_body_part: "Lower back",
      date_reported_to_employer: "2026-11-02",
      vehicles_involved: null,
      third_party_contact: null,
    });
  });

  it("drops fields that belong to a different line", () => {
    const details = lossDetailsFor(
      wc({ driverName: "Left over", thirdPartyContact: "555-0100" }),
      LINE_OF_BUSINESS.auto,
    );
    expect(details).toMatchObject({
      driver_name: "Left over",
      employee_name: null,
      date_reported_to_employer: null,
      third_party_contact: null,
    });
  });

  it("rejects a date reported to employer before the date of loss", async () => {
    const db = fakeDb();
    await expect(
      submitClaimCore(
        wc({ dateOfLoss: "2026-11-03", dateReportedToEmployer: "2026-11-02" }),
        db.deps,
      ),
    ).rejects.toThrow("before the date of loss");
    expect(db.claims).toHaveLength(0);
  });

  it("rejects a date reported to employer in the future", async () => {
    const db = fakeDb();
    await expect(
      submitClaimCore(wc({ dateReportedToEmployer: "2026-11-08" }), db.deps),
    ).rejects.toThrow("can't be in the future");
  });

  it("accepts a same-day report to the employer, and ignores the date on other lines", () => {
    const today = "2026-11-07";
    expect(
      claimRuleError(wc({ dateOfLoss: today, dateReportedToEmployer: today }), {
        lineCode: LINE_OF_BUSINESS.workersComp,
        today,
      }),
    ).toBeNull();
    expect(
      claimRuleError(wc({ dateReportedToEmployer: "2026-10-01" }), {
        lineCode: LINE_OF_BUSINESS.auto,
        today,
      }),
    ).toBeNull();
  });

  it("rejects a date of loss in the future and accepts today", async () => {
    const db = fakeDb();
    await expect(
      submitClaimCore(input({ dateOfLoss: "2026-11-08", documents: [] }), db.deps),
    ).rejects.toThrow("Date of loss can't be in the future");
    expect(db.claims).toHaveLength(0);
    await submitClaimCore(input({ dateOfLoss: "2026-11-07", documents: [] }), db.deps);
    expect(db.claims).toHaveLength(1);
  });

  it("rejects a policy whose line or term doesn't cover the loss", async () => {
    const db = fakeDb();
    await expect(
      submitClaimCore(input({ lineOfBusinessId: AUTO_LINE, documents: [] }), db.deps),
    ).rejects.toThrow("Policy GL-100 doesn't cover a Business Auto loss on 11/1/2026");
    await expect(
      submitClaimCore(input({ dateOfLoss: "2025-12-31", documents: [] }), db.deps),
    ).rejects.toThrow("doesn't cover");
    expect(db.claims).toHaveLength(0);
  });

  it("requires the third party's name and contact on General Liability", async () => {
    const db = fakeDb();
    await expect(
      submitClaimCore(input({ claimantName: "  ", documents: [] }), db.deps),
    ).rejects.toThrow("Third-party name is required");
    await expect(
      submitClaimCore(input({ thirdPartyContact: null, documents: [] }), db.deps),
    ).rejects.toThrow("Third-party contact is required");
    expect(db.claims).toHaveLength(0);

    await submitClaimCore(input({ documents: [] }), db.deps);
    expect(db.claims[0]).toMatchObject({
      claimant_name: "Jane Doe",
      third_party_contact: "jane@example.com",
    });
  });

  it("doesn't require a third party on other lines", () => {
    expect(
      claimRuleError(input({ claimantName: null, thirdPartyContact: null }), {
        lineCode: LINE_OF_BUSINESS.auto,
        today: "2026-11-07",
      }),
    ).toBeNull();
  });

  it("validates the reporter email and time format", () => {
    const base = { ...input(), documents: [] };
    expect(SubmitClaimSchema.safeParse({ ...base, reporterEmail: "not-an-email" }).success).toBe(
      false,
    );
    expect(SubmitClaimSchema.safeParse({ ...base, timeOfLoss: "2pm" }).success).toBe(false);
    expect(SubmitClaimSchema.safeParse({ ...base, timeOfLoss: "14:05" }).success).toBe(true);
  });
});
