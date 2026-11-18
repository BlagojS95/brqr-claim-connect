import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PostMessageSchema,
  filterMentionCandidates,
  findMentions,
  insertMention,
  mentionQueryAt,
  sortMessagesOldestFirst,
  splitMentions,
  type MentionCandidate,
} from "@/lib/claim-messages";
import { CLAIM_ACTIVITY_KINDS } from "@/lib/claim-activity";

const PEOPLE: MentionCandidate[] = [
  { userId: "s1", name: "Jane Broker", kind: "staff" },
  { userId: "c1", name: "Ann", kind: "client" },
  { userId: "c2", name: "Anna Smith", kind: "client" },
];

describe("findMentions", () => {
  it("finds full names after @, case-insensitive", () => {
    expect(findMentions("Hi @jane broker, can you check?", PEOPLE)).toEqual(["s1"]);
  });

  it("needs the whole name: @Ann doesn't match inside @Anna Smith", () => {
    expect(findMentions("@Anna Smith please call", PEOPLE)).toEqual(["c2"]);
    expect(findMentions("@Ann please call", PEOPLE)).toEqual(["c1"]);
    expect(findMentions("@Anna please call", PEOPLE)).toEqual([]);
  });

  it("ignores an @ inside a word or email address", () => {
    expect(findMentions("write to bob@Ann", PEOPLE)).toEqual([]);
  });

  it("finds several people once each, and nobody outside the list", () => {
    expect(findMentions("@Ann @Jane Broker @Ann @Someone Else", PEOPLE)).toEqual(["s1", "c1"]);
  });

  it("matches at the end of the text and before punctuation", () => {
    expect(findMentions("thanks @Ann", PEOPLE)).toEqual(["c1"]);
    expect(findMentions("thanks @Ann!", PEOPLE)).toEqual(["c1"]);
  });
});

describe("composer helpers", () => {
  it("spots the @query before the caret", () => {
    expect(mentionQueryAt("Hi @Ja", 6)).toEqual({ start: 3, query: "Ja" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("Hi @Jane Bro", 12)).toEqual({ start: 3, query: "Jane Bro" });
  });

  it("ignores emails, line breaks and finished mentions", () => {
    expect(mentionQueryAt("me@ex", 5)).toBeNull();
    expect(mentionQueryAt("@Jane\nok", 8)).toBeNull();
    expect(mentionQueryAt("@Jane  ok", 9)).toBeNull();
    expect(mentionQueryAt("no at here", 10)).toBeNull();
  });

  it("filters by the start of any word of the name", () => {
    expect(filterMentionCandidates(PEOPLE, "sm").map((c) => c.userId)).toEqual(["c2"]);
    expect(filterMentionCandidates(PEOPLE, "an").map((c) => c.userId)).toEqual(["c1", "c2"]);
    expect(filterMentionCandidates(PEOPLE, "").length).toBe(3);
    expect(filterMentionCandidates(PEOPLE, "", 2).length).toBe(2);
  });

  it("inserts the picked name and moves the caret after it", () => {
    expect(insertMention("Hi @Ja thanks", 3, 6, "Jane Broker")).toEqual({
      text: "Hi @Jane Broker thanks",
      caret: 16,
    });
    expect(insertMention("@", 0, 1, "Ann")).toEqual({ text: "@Ann ", caret: 5 });
  });
});

describe("splitMentions", () => {
  it("marks the @Name parts", () => {
    expect(splitMentions("Hi @Anna Smith and @Ann.", ["Ann", "Anna Smith"])).toEqual([
      { text: "Hi ", mention: false },
      { text: "@Anna Smith", mention: true },
      { text: " and ", mention: false },
      { text: "@Ann", mention: true },
      { text: ".", mention: false },
    ]);
  });

  it("leaves text without mentions alone", () => {
    expect(splitMentions("plain @nobody", [])).toEqual([{ text: "plain @nobody", mention: false }]);
  });
});

describe("messages", () => {
  it("sorts oldest first", () => {
    const rows = [
      { id: "b", createdAt: "2026-11-17T10:00:00Z" },
      { id: "a", createdAt: "2026-11-17T09:00:00Z" },
      { id: "c", createdAt: "2026-11-17T10:00:00Z" },
    ];
    expect(sortMessagesOldestFirst(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("validates the body", () => {
    const claimId = "00000000-0000-4000-8000-000000000000";
    expect(PostMessageSchema.safeParse({ claimId, body: "   " }).success).toBe(false);
    expect(PostMessageSchema.safeParse({ claimId, body: "x".repeat(4001) }).success).toBe(false);
    expect(PostMessageSchema.parse({ claimId, body: "  hello  " }).body).toBe("hello");
  });

  it("every activity kind is allowed by the latest CHECK constraint", () => {
    const sql = readFileSync("supabase/migrations/20261117000100_claim_messages.sql", "utf8");
    const check = sql.slice(sql.lastIndexOf("claim_activity_kind_check"));
    for (const kind of CLAIM_ACTIVITY_KINDS) expect(check).toContain(`'${kind}'`);
  });
});
