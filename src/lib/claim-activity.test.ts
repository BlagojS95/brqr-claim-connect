import { describe, expect, it } from "vitest";
import {
  activityAuthorLabel,
  claimActivityLabel,
  formatActivityTimestamp,
  MAX_ACTIVITY_NOTE_LENGTH,
  normalizeActivityNote,
  notificationActivityBody,
  sortActivityNewestFirst,
} from "./claim-activity";

describe("claimActivityLabel", () => {
  it("labels known kinds and passes unknown ones through", () => {
    expect(claimActivityLabel("status_change")).toBe("Status change");
    expect(claimActivityLabel("follow_up")).toBe("Follow-up");
    expect(claimActivityLabel("note")).toBe("Note");
    expect(claimActivityLabel("something_else")).toBe("something_else");
  });
});

describe("sortActivityNewestFirst", () => {
  it("puts the newest entry first and keeps ties stable by id", () => {
    const rows = [
      { id: "a", created_at: "2026-11-01T10:00:00Z" },
      { id: "c", created_at: "2026-11-03T10:00:00Z" },
      { id: "b", created_at: "2026-11-01T10:00:00Z" },
    ];
    expect(sortActivityNewestFirst(rows).map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(rows.map((r) => r.id)).toEqual(["a", "c", "b"]);
  });
});

describe("activityAuthorLabel", () => {
  it("shows System when there is no actor", () => {
    expect(activityAuthorLabel(null, undefined)).toBe("System");
  });
  it("shows agency staff as the agency, with the email when known", () => {
    expect(activityAuthorLabel("u1", { isAgency: true, email: "jo@brqr.com" })).toBe(
      "BRQR Agency (jo@brqr.com)",
    );
    expect(activityAuthorLabel("u1", { isAgency: true })).toBe("BRQR Agency");
  });
  it("shows a client by name, then email", () => {
    expect(activityAuthorLabel("u2", { isAgency: false, clientName: "Acme" })).toBe("Acme");
    expect(activityAuthorLabel("u2", { isAgency: false, clientName: " ", email: "a@x.com" })).toBe(
      "a@x.com",
    );
    expect(activityAuthorLabel("u2", { isAgency: false })).toBe("Client");
  });
  it("adds who at the company wrote it (fix 32)", () => {
    expect(
      activityAuthorLabel("u3", { isAgency: false, clientName: "Acme", userName: "Jane Roe" }),
    ).toBe("Acme (Jane Roe)");
    expect(
      activityAuthorLabel("u3", { isAgency: false, clientName: "Acme", email: "jane@acme.com" }),
    ).toBe("Acme (jane@acme.com)");
    // The first login is named after the company; don't repeat it.
    expect(
      activityAuthorLabel("u2", { isAgency: false, clientName: "Acme", userName: "acme" }),
    ).toBe("Acme");
  });
  it("falls back when the user can't be found", () => {
    expect(activityAuthorLabel("gone", undefined)).toBe("Unknown user");
  });
});

describe("notificationActivityBody", () => {
  it("describes sent and failed emails with the recipient", () => {
    expect(notificationActivityBody("email", "sent", "service@brqr.com")).toBe(
      "Notification email sent to service@brqr.com",
    );
    expect(notificationActivityBody("email", "failed", "service@brqr.com")).toBe(
      "Notification email to service@brqr.com failed",
    );
  });
  it("describes the webhook separately", () => {
    expect(notificationActivityBody("webhook", "sent", "x")).toBe(
      "Claim sent to the agency workflow",
    );
    expect(notificationActivityBody("webhook", "failed", "x")).toBe(
      "Agency workflow update failed",
    );
  });
});

describe("normalizeActivityNote", () => {
  it("trims and rejects empty or overlong notes", () => {
    expect(normalizeActivityNote("  hello \n")).toBe("hello");
    expect(normalizeActivityNote("   ")).toBeNull();
    expect(normalizeActivityNote("x".repeat(MAX_ACTIVITY_NOTE_LENGTH))).toHaveLength(
      MAX_ACTIVITY_NOTE_LENGTH,
    );
    expect(normalizeActivityNote("x".repeat(MAX_ACTIVITY_NOTE_LENGTH + 1))).toBeNull();
  });
});

describe("formatActivityTimestamp", () => {
  it("formats a timestamp with date and time, and blanks bad input", () => {
    const out = formatActivityTimestamp("2026-11-07T15:30:00Z", "en-US");
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/\d{1,2}:\d{2}/);
    expect(formatActivityTimestamp("not a date")).toBe("");
  });
});
