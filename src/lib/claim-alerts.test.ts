import { describe, expect, it, vi } from "vitest";
import {
  buildMessageEmail,
  claimAudience,
  deliverAlerts,
  messageRecipients,
  type AudienceMember,
} from "@/lib/claim-alerts";

const L1 = "loc-1";
const L2 = "loc-2";

describe("claimAudience", () => {
  const logins = [
    { user_id: "admin", role: "client_admin" as const, location_ids: [] },
    { user_id: "company", role: "company" as const, location_ids: [] },
    { user_id: "loc1", role: "location" as const, location_ids: [L1] },
    { user_id: "loc2", role: "location" as const, location_ids: [L2] },
  ];

  it("has every staff member and the client logins that cover the claim's location", () => {
    const ids = claimAudience({ location_id: L1 }, ["staff"], logins).map((m) => m.userId);
    expect(ids).toEqual(["staff", "admin", "company", "loc1"]);
  });

  it("leaves location users out of claims with no location", () => {
    const ids = claimAudience({ location_id: null }, [], logins).map((m) => m.userId);
    expect(ids).toEqual(["admin", "company"]);
  });

  it("adds the client's first login when it is missing from client_users", () => {
    const members = claimAudience({ location_id: null }, ["staff"], [], "primary");
    expect(members).toEqual([
      { userId: "staff", isStaff: true },
      { userId: "primary", isStaff: false },
    ]);
  });
});

describe("messageRecipients", () => {
  const audience: AudienceMember[] = [
    { userId: "staff-a", isStaff: true },
    { userId: "staff-b", isStaff: true },
    { userId: "client-a", isStaff: false },
  ];

  it("emails the mentioned people and the assigned staff member, once each", () => {
    expect(
      messageRecipients({
        audience,
        mentionIds: ["client-a", "staff-a"],
        assignedTo: "staff-a",
        authorId: "staff-b",
      }),
    ).toEqual(["client-a", "staff-a"]);
  });

  it("never emails the author, even when mentioned or assigned", () => {
    expect(
      messageRecipients({
        audience,
        mentionIds: ["staff-a", "client-a"],
        assignedTo: "staff-a",
        authorId: "staff-a",
      }),
    ).toEqual(["client-a"]);
  });

  it("skips people who can't see the claim", () => {
    expect(
      messageRecipients({
        audience,
        mentionIds: ["stranger"],
        assignedTo: "former-staff",
        authorId: "client-a",
      }),
    ).toEqual([]);
  });
});

describe("buildMessageEmail", () => {
  const claim = { id: "c 1", claim_number: "AB-1", claim_type: "Auto", client_name: "Acme" };

  it("says who wrote it, quotes the message escaped and links the claim", () => {
    const email = buildMessageEmail({
      claim,
      authorName: "Jane",
      body: "<b>hi</b> @Ann",
      reason: "mentioned",
    });
    expect(email.subject).toBe("Jane mentioned you on claim AB-1 | ClaimsQR");
    expect(email.html).toContain("&lt;b&gt;hi&lt;/b&gt; @Ann");
    expect(email.html).not.toContain("<b>hi</b>");
    expect(email.html).toContain('href="https://www.claimsqr.com/claims/c%201"');
    expect(email.text).toContain("Auto claim AB-1 · Acme");
    expect(email.text).toContain("you were mentioned");
  });

  it("uses a plain subject for the assigned staff member", () => {
    const email = buildMessageEmail({
      claim: { ...claim, claim_number: null },
      authorName: "Acme",
      body: "x",
      reason: "assigned",
    });
    expect(email.subject).toBe("New message from Acme on a claim | ClaimsQR");
    expect(email.text).toContain("assigned to you");
  });
});

describe("deliverAlerts", () => {
  const build = () => ({ subject: "S", html: "H", text: "T" });

  it("sends one email per recipient with an address", async () => {
    const send = vi.fn(async () => {});
    const result = await deliverAlerts(
      [
        { userId: "a", email: "a@test.invalid" },
        { userId: "b", email: null },
        { userId: "c", email: "c@test.invalid" },
      ],
      build,
      { send },
    );
    expect(result).toEqual({ sent: 2, failed: 0, skipped: 1 });
    expect(send).toHaveBeenCalledWith("S", "H", { to: "a@test.invalid", text: "T" });
    expect(send).toHaveBeenCalledWith("S", "H", { to: "c@test.invalid", text: "T" });
  });

  it("counts a failed send and carries on, without throwing", async () => {
    const send = vi
      .fn<(s: string, h: string, o: { to: string; text: string }) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Resend down"))
      .mockResolvedValue(undefined);
    const log = vi.fn();
    const result = await deliverAlerts(
      [
        { userId: "a", email: "a@test.invalid" },
        { userId: "b", email: "b@test.invalid" },
      ],
      build,
      { send, log },
    );
    expect(result).toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect(log).toHaveBeenCalledOnce();
  });

  it("waits between sends to stay under Resend's rate limit", async () => {
    const sleep = vi.fn(async () => {});
    await deliverAlerts(
      [
        { userId: "a", email: "a@test.invalid" },
        { userId: "b", email: "b@test.invalid" },
      ],
      build,
      { send: async () => {}, sleep },
    );
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
