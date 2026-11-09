// Document requests on a claim (claim_document_requests table,
// supabase/migrations/20261109000200_claim_document_requests.sql). An agency
// admin names a document; the client uploads against it and a trigger closes
// the request. Pure helpers only, shared by the server functions and the UI.

import { todayIso } from "@/lib/dates";

// Same limits as the CHECK constraints on the table.
export const MAX_REQUEST_NAME_LENGTH = 200;
export const MAX_REQUEST_NOTE_LENGTH = 2000;

export interface DocumentRequest {
  id: string;
  claim_id: string;
  name: string;
  note: string | null;
  requested_at: string;
  fulfilled_at: string | null;
  fulfilled_document_id: string | null;
  /** The uploaded document that answered it, when RLS lets the caller see it. */
  document: { file_name: string; file_url: string } | null;
}

export function isFulfilled(request: Pick<DocumentRequest, "fulfilled_at">): boolean {
  return request.fulfilled_at != null;
}

/** Open requests oldest first (ask order), fulfilled ones newest received first. */
export function splitDocumentRequests<
  T extends Pick<DocumentRequest, "fulfilled_at" | "requested_at">,
>(requests: T[]): { open: T[]; fulfilled: T[] } {
  const open = requests
    .filter((r) => !isFulfilled(r))
    .sort((a, b) => a.requested_at.localeCompare(b.requested_at));
  const fulfilled = requests
    .filter(isFulfilled)
    .sort((a, b) => (b.fulfilled_at ?? "").localeCompare(a.fulfilled_at ?? ""));
  return { open, fulfilled };
}

export type DocumentRequestInput = { name: string; note: string | null };

/**
 * Trims the name and note and checks them against the table limits. A blank
 * note becomes null. Returns the cleaned values or an error message.
 */
export function validateDocumentRequest(input: {
  name: string;
  note?: string | null;
}): { ok: true; value: DocumentRequestInput } | { ok: false; error: string } {
  const name = input.name.trim();
  const note = input.note?.trim() || null;
  if (!name) return { ok: false, error: "Enter the name of the document you need" };
  if (name.length > MAX_REQUEST_NAME_LENGTH)
    return {
      ok: false,
      error: `Document name can be at most ${MAX_REQUEST_NAME_LENGTH} characters`,
    };
  if (note && note.length > MAX_REQUEST_NOTE_LENGTH)
    return { ok: false, error: `Note can be at most ${MAX_REQUEST_NOTE_LENGTH} characters` };
  return { ok: true, value: { name, note } };
}

/**
 * fulfilled_at is a timestamp, so it is put on the agency's calendar before
 * being shown as a date ("2026-11-09T03:00:00Z" is still Nov 8 in New York).
 */
export function receivedDate(fulfilledAt: string | null | undefined): string | null {
  if (!fulfilledAt) return null;
  const time = Date.parse(fulfilledAt);
  return Number.isNaN(time) ? null : todayIso(new Date(time));
}
