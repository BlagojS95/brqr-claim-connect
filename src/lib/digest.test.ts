import { describe, expect, it } from "vitest";
import {
  buildDigest,
  claimUrl,
  collectDigestItems,
  countDigestRuns,
  escapeDigestHtml,
  isAuthorizedCronRequest,
  scopeDigestDataToClient,
  weekStart,
  type DigestClaim,
  type DigestData,
} from "./digest";

const NOW = new Date("2026-11-09T13:00:00Z"); // Monday 8:00 in New York

function claim(overrides: Partial<DigestClaim> & { id: string }): DigestClaim {
  return {
    client_id: "client-a",
    claim_number: "CN-1",
    claimant_name: "Jane Doe",
    claim_type: "Auto",
    status: "open",
    is_notice_only: false,
    date_of_loss: "2026-10-01",
    created_at: "2026-09-01T12:00:00Z",
    ...overrides,
  };
}

const empty: DigestData = { claims: [], activity: [], documentRequests: [] };

describe("weekStart", () => {
  it("gives the Monday of the week on the New York calendar", () => {
    expect(weekStart(new Date("2026-11-09T13:00:00Z"))).toBe("2026-11-09"); // Monday
    expect(weekStart(new Date("2026-11-12T15:00:00Z"))).toBe("2026-11-09"); // Thursday
    expect(weekStart(new Date("2026-11-15T23:00:00Z"))).toBe("2026-11-09"); // Sunday evening
  });

  it("uses New York, not UTC, around midnight", () => {
    // 02:00 UTC Monday is still Sunday evening in New York.
    expect(weekStart(new Date("2026-11-16T02:00:00Z"))).toBe("2026-11-09");
    expect(weekStart(new Date("2026-11-16T06:00:00Z"))).toBe("2026-11-16");
  });

  it("crosses month and year boundaries", () => {
    expect(weekStart(new Date("2026-01-01T17:00:00Z"))).toBe("2025-12-29");
  });
});

describe("scopeDigestDataToClient", () => {
  it("drops other clients' claims, activity and document requests", () => {
    const data: DigestData = {
      claims: [claim({ id: "a1" }), claim({ id: "b1", client_id: "client-b" })],
      activity: [
        { claim_id: "a1", kind: "status_change", body: "A", created_at: "2026-11-08T00:00:00Z" },
        { claim_id: "b1", kind: "status_change", body: "B", created_at: "2026-11-08T00:00:00Z" },
        { claim_id: "zz", kind: "status_change", body: "?", created_at: "2026-11-08T00:00:00Z" },
      ],
      documentRequests: [
        {
          claim_id: "a1",
          name: "Photos",
          requested_at: "2026-11-01T00:00:00Z",
          fulfilled_at: null,
        },
        {
          claim_id: "b1",
          name: "Invoice",
          requested_at: "2026-11-01T00:00:00Z",
          fulfilled_at: null,
        },
      ],
    };
    const scoped = scopeDigestDataToClient("client-a", data);
    expect(scoped.claims.map((c) => c.id)).toEqual(["a1"]);
    expect(scoped.activity.map((a) => a.body)).toEqual(["A"]);
    expect(scoped.documentRequests.map((r) => r.name)).toEqual(["Photos"]);
  });

  it("returns nothing for a client with no claims", () => {
    const data: DigestData = {
      claims: [claim({ id: "b1", client_id: "client-b" })],
      activity: [
        { claim_id: "b1", kind: "status_change", body: "B", created_at: "2026-11-08T00:00:00Z" },
      ],
      documentRequests: [],
    };
    expect(scopeDigestDataToClient("client-a", data)).toEqual(empty);
  });
});

describe("collectDigestItems", () => {
  it("finds new claims, status changes, open requests and claims awaiting a carrier number", () => {
    const data: DigestData = {
      claims: [
        claim({
          id: "new",
          created_at: "2026-11-08T12:00:00Z",
          status: "submitted",
          claim_number: null,
        }),
        claim({ id: "old" }),
        claim({
          id: "waiting",
          status: "submitted",
          claim_number: null,
          created_at: "2026-10-20T12:00:00Z",
        }),
        claim({
          id: "notice",
          status: "submitted",
          claim_number: null,
          is_notice_only: true,
          created_at: "2026-10-20T12:00:00Z",
        }),
        claim({ id: "closed", status: "closed" }),
      ],
      activity: [
        {
          claim_id: "old",
          kind: "status_change",
          body: "Status changed from Open to Closed",
          created_at: "2026-11-05T12:00:00Z",
        },
        {
          claim_id: "old",
          kind: "status_change",
          body: "Too old",
          created_at: "2026-10-01T12:00:00Z",
        },
        {
          claim_id: "old",
          kind: "note",
          body: "Not a status change",
          created_at: "2026-11-05T12:00:00Z",
        },
      ],
      documentRequests: [
        {
          claim_id: "old",
          name: "Photos",
          requested_at: "2026-11-01T00:00:00Z",
          fulfilled_at: null,
        },
        {
          claim_id: "old",
          name: "Done",
          requested_at: "2026-11-01T00:00:00Z",
          fulfilled_at: "2026-11-02T00:00:00Z",
        },
        {
          claim_id: "closed",
          name: "Closed claim",
          requested_at: "2026-11-01T00:00:00Z",
          fulfilled_at: null,
        },
      ],
    };
    const items = collectDigestItems(data, NOW);
    expect(items.newClaims.map((c) => c.id)).toEqual(["new"]);
    expect(items.statusChanges.map((s) => s.body)).toEqual(["Status changed from Open to Closed"]);
    expect(items.openRequests.map((r) => r.name)).toEqual(["Photos"]);
    // "new" has no carrier number either, but it is only a day old.
    expect(items.awaitingCarrierNumber.map((c) => c.id)).toEqual(["waiting"]);
  });

  it("flags a submitted claim once it is 3 days without a carrier number", () => {
    const data: DigestData = {
      ...empty,
      claims: [
        claim({
          id: "3d",
          status: "submitted",
          claim_number: " ",
          created_at: "2026-11-06T13:00:00Z",
        }),
        claim({
          id: "2d",
          status: "submitted",
          claim_number: null,
          created_at: "2026-11-07T13:00:00Z",
        }),
      ],
    };
    expect(collectDigestItems(data, NOW).awaitingCarrierNumber.map((c) => c.id)).toEqual(["3d"]);
  });
});

describe("buildDigest", () => {
  it("returns null when there is nothing to report", () => {
    expect(buildDigest(empty, { now: NOW })).toBeNull();
    expect(buildDigest({ ...empty, claims: [claim({ id: "old" })] }, { now: NOW })).toBeNull();
  });

  it("links each claim, brands the email and includes the opt-out", () => {
    const data: DigestData = {
      ...empty,
      claims: [claim({ id: "abc-123", created_at: "2026-11-08T12:00:00Z" })],
    };
    const email = buildDigest(data, { now: NOW, recipientName: "Acme LLC" });
    expect(email).not.toBeNull();
    expect(email!.subject).toBe("Your weekly ClaimsQR update: 1 new claim");
    expect(email!.itemCount).toBe(1);
    expect(email!.html).toContain(`href="https://www.claimsqr.com/claims/abc-123"`);
    expect(email!.html).toContain("ClaimsQR");
    expect(email!.html).toContain("https://www.claimsqr.com/settings");
    expect(email!.text).toContain("https://www.claimsqr.com/claims/abc-123");
    expect(email!.text).toContain("https://www.claimsqr.com/settings");
    expect(email!.text).toContain("Hello Acme LLC,");
    expect(email!.text).toContain("DOL 10/1/2026");
  });

  it("escapes everything that came from the database", () => {
    const data: DigestData = {
      claims: [
        claim({
          id: "x",
          claimant_name: `<script>alert("x")</script>`,
          claim_number: "A&B",
          created_at: "2026-11-08T12:00:00Z",
        }),
      ],
      activity: [],
      documentRequests: [
        {
          claim_id: "x",
          name: `<img src=x onerror=alert(1)>`,
          requested_at: "2026-11-01T00:00:00Z",
          fulfilled_at: null,
        },
      ],
    };
    const email = buildDigest(data, { now: NOW, recipientName: "<b>Evil</b>" })!;
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("<b>Evil</b>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("A&amp;B");
  });

  it("marks a test digest and shows client names", () => {
    const data: DigestData = {
      ...empty,
      claims: [claim({ id: "x", client_name: "Acme LLC", created_at: "2026-11-08T12:00:00Z" })],
    };
    const email = buildDigest(data, { now: NOW, isTest: true, showClientName: true })!;
    expect(email.subject.startsWith("[Test] ")).toBe(true);
    expect(email.text).toContain("Acme LLC · Claim # CN-1");
    expect(email.text).toContain("test digest");
  });
});

describe("helpers", () => {
  it("escapes HTML special characters", () => {
    expect(escapeDigestHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("encodes the claim id in the link", () => {
    expect(claimUrl("a b")).toBe("https://www.claimsqr.com/claims/a%20b");
  });

  it("counts runs by status and ignores unknown values", () => {
    expect(
      countDigestRuns([
        { status: "sent" },
        { status: "sent" },
        { status: "failed" },
        { status: "x" },
      ]),
    ).toEqual({ sent: 2, skipped: 0, failed: 1 });
  });

  it("only accepts the exact bearer secret", () => {
    expect(isAuthorizedCronRequest("Bearer s3cret", "s3cret")).toBe(true);
    expect(isAuthorizedCronRequest("Bearer s3cre", "s3cret")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer s3cretX", "s3cret")).toBe(false);
    expect(isAuthorizedCronRequest("s3cret", "s3cret")).toBe(false);
    expect(isAuthorizedCronRequest(null, "s3cret")).toBe(false);
    expect(isAuthorizedCronRequest("", "s3cret")).toBe(false);
  });
});
