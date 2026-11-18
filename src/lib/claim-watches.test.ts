import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALERT_PREFS,
  alertPrefsFromRow,
  buildDocumentRequestEmail,
  buildStatusChangeEmail,
  chooseAlertRecipients,
  statusChangeOf,
  type AlertPrefs,
  type AudienceMember,
} from "@/lib/claim-alerts";

const audience: AudienceMember[] = [
  { userId: "staff", isStaff: true },
  { userId: "staff2", isStaff: true },
  { userId: "client", isStaff: false },
  { userId: "client2", isStaff: false },
];
const claim = { id: "c1", claim_number: "123-A", claim_type: "Auto", client_name: "Acme" };

function prefs(over: Partial<AlertPrefs> = {}): AlertPrefs {
  return { ...DEFAULT_ALERT_PREFS, ...over };
}

describe("alertPrefsFromRow", () => {
  it("defaults to watched on and all off when there is no row", () => {
    expect(alertPrefsFromRow(null)).toEqual(DEFAULT_ALERT_PREFS);
    expect(DEFAULT_ALERT_PREFS.status).toEqual({ watched: true, all: false });
  });

  it("reads each column and falls back to the default for a missing one", () => {
    const p = alertPrefsFromRow({ messages_watched: false, documents_all: true });
    expect(p.messages).toEqual({ watched: false, all: false });
    expect(p.documents).toEqual({ watched: true, all: true });
    expect(p.status).toEqual({ watched: true, all: false });
  });
});

describe("chooseAlertRecipients", () => {
  const base = { audience, prefsByUser: new Map<string, AlertPrefs>(), actorId: null };

  it("emails watchers with the default settings, and nobody else", () => {
    const out = chooseAlertRecipients({
      ...base,
      event: "status",
      watcherIds: ["staff", "client"],
    });
    expect(out).toEqual([
      { userId: "staff", reason: "watching" },
      { userId: "client", reason: "watching" },
    ]);
  });

  it("skips a watcher who turned the watched switch off for that event", () => {
    const out = chooseAlertRecipients({
      ...base,
      event: "status",
      watcherIds: ["staff", "client"],
      prefsByUser: new Map([["staff", prefs({ status: { watched: false, all: false } })]]),
    });
    expect(out.map((r) => r.userId)).toEqual(["client"]);
  });

  it("keeps each event separate", () => {
    const out = chooseAlertRecipients({
      ...base,
      event: "documents",
      watcherIds: ["staff"],
      prefsByUser: new Map([["staff", prefs({ status: { watched: false, all: false } })]]),
    });
    expect(out.map((r) => r.userId)).toEqual(["staff"]);
  });

  it("emails everyone who turned on all claims, watching or not", () => {
    const out = chooseAlertRecipients({
      ...base,
      event: "messages",
      watcherIds: [],
      prefsByUser: new Map([["client2", prefs({ messages: { watched: true, all: true } })]]),
    });
    expect(out).toEqual([{ userId: "client2", reason: "all" }]);
  });

  it("never emails the person who caused the event", () => {
    const out = chooseAlertRecipients({
      ...base,
      event: "status",
      actorId: "staff",
      watcherIds: ["staff", "client"],
    });
    expect(out.map((r) => r.userId)).toEqual(["client"]);
  });

  it("ignores watchers who can no longer see the claim", () => {
    const out = chooseAlertRecipients({ ...base, event: "status", watcherIds: ["gone"] });
    expect(out).toEqual([]);
  });

  it("always includes direct recipients, once, keeping their reason", () => {
    const out = chooseAlertRecipients({
      ...base,
      event: "messages",
      actorId: "client",
      watcherIds: ["staff", "client"],
      direct: [
        { userId: "staff", reason: "mentioned" },
        { userId: "client", reason: "mentioned" },
        { userId: "outsider", reason: "mentioned" },
        { userId: "staff2", reason: "assigned" },
      ],
    });
    expect(out).toEqual([
      { userId: "staff", reason: "mentioned" },
      { userId: "staff2", reason: "assigned" },
    ]);
  });
});

describe("statusChangeOf", () => {
  it("finds the status change", () => {
    expect(
      statusChangeOf([
        { field: "paid_amount", from: "$0", to: "$5" },
        { field: "status", from: "Open", to: "Closed" },
      ]),
    ).toEqual({ from: "Open", to: "Closed" });
  });
  it("is null without one", () => {
    expect(statusChangeOf([{ field: "adjuster_name", from: "A", to: "B" }])).toBeNull();
    expect(statusChangeOf([{ field: "status", from: "Open", to: "Open" }])).toBeNull();
  });
});

describe("alert emails", () => {
  it("status email names the claim and both statuses", () => {
    const e = buildStatusChangeEmail({ claim, from: "Open", to: "Closed", reason: "watching" });
    expect(e.subject).toContain("Closed");
    expect(e.subject).toContain("123-A");
    expect(e.text).toContain("Open to Closed");
    expect(e.text).toContain("you watch this claim");
  });
  it("document request email carries the name and escapes the note", () => {
    const e = buildDocumentRequestEmail({
      claim,
      name: "Police report",
      note: "<b>asap</b>",
      reason: "all",
    });
    expect(e.text).toContain("Police report");
    expect(e.html).not.toContain("<b>asap</b>");
    expect(e.text).toContain("every claim");
  });
});
