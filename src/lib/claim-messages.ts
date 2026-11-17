// Claim messages (fix 47): the conversation between a client and the agency on
// one claim. Pure helpers shared by the Messages section on the claim page and
// the server functions in claim-messages.functions.ts; no Supabase imports.
import { z } from "zod";

/** Same limit as the CHECK on claim_messages.body. */
export const MAX_MESSAGE_LENGTH = 4000;

export const PostMessageSchema = z.object({
  claimId: z.string().uuid(),
  body: z
    .string()
    .trim()
    .min(1, "Write a message first")
    .max(MAX_MESSAGE_LENGTH, `Messages can be at most ${MAX_MESSAGE_LENGTH} characters`),
});
export type PostMessageInput = z.infer<typeof PostMessageSchema>;

export type MentionKind = "staff" | "client";

/** Someone who can be @mentioned on a claim: they can see it. */
export interface MentionCandidate {
  userId: string;
  name: string;
  kind: MentionKind;
}

export interface ClaimMessage {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  /** Written by agency staff. */
  authorIsStaff: boolean;
  /** Written by the signed-in user. */
  isMine: boolean;
  /** Names of the people mentioned, to highlight "@Name" in the text. */
  mentionNames: string[];
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * The candidates whose "@Name" appears in the text, in candidate order. The
 * name must end at a word boundary, so "@Ann" doesn't match "@Anna Smith".
 * Case-insensitive. The server runs this on the message it stores, so the ids
 * never come from the browser.
 */
export function findMentions(body: string, candidates: readonly MentionCandidate[]): string[] {
  const text = body.toLowerCase();
  const found: string[] = [];
  for (const c of candidates) {
    const name = c.name.trim().toLowerCase();
    if (!name || found.includes(c.userId)) continue;
    const needle = `@${name}`;
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at < 0) break;
      const before = at === 0 ? "" : text[at - 1];
      const after = text[at + needle.length] ?? "";
      if ((!before || !WORD_CHAR.test(before)) && (!after || !WORD_CHAR.test(after))) {
        found.push(c.userId);
        break;
      }
      from = at + 1;
    }
  }
  return found;
}

/**
 * The "@query" being typed just before the caret, or null. Starts at an "@"
 * that begins the text or follows whitespace; may contain single spaces (for
 * "@Jane Do") but not line breaks, and at most 40 characters.
 */
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n\r]|\s{2}/.test(query) || query.startsWith(" ")) return null;
  return { start: at, query };
}

/** Candidates matching what was typed after "@": any word of the name starts with it. */
export function filterMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
  limit = 8,
): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  const matches = candidates.filter((c) => {
    if (!q) return true;
    const name = c.name.toLowerCase();
    return name.startsWith(q) || name.split(/\s+/).some((word) => word.startsWith(q));
  });
  return matches.slice(0, limit);
}

/** Replaces the "@query" at start..caret with "@Name " and returns the new caret. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name} `;
  const rest = text.slice(caret).replace(/^ /, "");
  return {
    text: text.slice(0, start) + inserted + rest,
    caret: start + inserted.length,
  };
}

/** Oldest first; ties broken by id so the order is stable. */
export function sortMessagesOldestFirst<T extends { id: string; createdAt: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
    return a.id.localeCompare(b.id);
  });
}

/** Splits a message into plain text and "@Name" parts for highlighting. */
export function splitMentions(
  body: string,
  names: readonly string[],
): { text: string; mention: boolean }[] {
  const wanted = names
    .map((n) => n.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!wanted.length) return [{ text: body, mention: false }];
  const lower = body.toLowerCase();
  const parts: { text: string; mention: boolean }[] = [];
  let plainFrom = 0;
  let i = 0;
  while (i < body.length) {
    const prev = i === 0 ? "" : body[i - 1];
    if (body[i] === "@" && (!prev || !WORD_CHAR.test(prev))) {
      const name = wanted.find((n) => {
        if (!lower.startsWith(`@${n.toLowerCase()}`, i)) return false;
        const after = body[i + n.length + 1] ?? "";
        return !after || !WORD_CHAR.test(after);
      });
      if (name) {
        if (i > plainFrom) parts.push({ text: body.slice(plainFrom, i), mention: false });
        parts.push({ text: body.slice(i, i + name.length + 1), mention: true });
        i += name.length + 1;
        plainFrom = i;
        continue;
      }
    }
    i++;
  }
  if (plainFrom < body.length) parts.push({ text: body.slice(plainFrom), mention: false });
  return parts;
}
