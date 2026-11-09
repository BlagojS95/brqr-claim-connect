import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseInput, unprocessable } from "@/lib/http-errors.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import {
  MAX_REQUEST_NAME_LENGTH,
  MAX_REQUEST_NOTE_LENGTH,
  validateDocumentRequest,
  type DocumentRequest,
} from "@/lib/document-requests";

const ClaimSchema = z.object({ claimId: z.string().uuid() });

// Reads with the caller's own token: RLS lets an agency_admin see every
// request and a client only the requests on their own claims.
export const listDocumentRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseInput(ClaimSchema))
  .handler(async ({ data, context }): Promise<DocumentRequest[]> => {
    const { data: rows, error } = await context.supabase
      .from("claim_document_requests")
      .select(
        "id, claim_id, name, note, requested_at, fulfilled_at, fulfilled_document_id, " +
          "document:documents!claim_document_requests_fulfilled_document_id_fkey(file_name, file_url)",
      )
      .eq("claim_id", data.claimId)
      .order("requested_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as DocumentRequest[];
  });

const CreateSchema = z.object({
  claimId: z.string().uuid(),
  name: z.string().max(MAX_REQUEST_NAME_LENGTH * 2),
  note: z
    .string()
    .max(MAX_REQUEST_NOTE_LENGTH * 2)
    .nullish(),
});

// Agency staff only. The DB trigger logs the activity entry and sets the
// claim's waiting_on to the client.
export const createDocumentRequest = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(CreateSchema))
  .handler(async ({ data, context }) => {
    const checked = validateDocumentRequest(data);
    if (!checked.ok) unprocessable(checked.error);
    const { error } = await context.supabase.from("claim_document_requests").insert({
      claim_id: data.claimId,
      name: checked.value.name,
      note: checked.value.note,
      requested_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const DeleteSchema = z.object({ requestId: z.string().uuid() });

// Agency staff only, and only while the request is still open: a fulfilled
// request is the record of what the client sent.
export const deleteDocumentRequest = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(DeleteSchema))
  .handler(async ({ data, context }) => {
    const { data: deleted, error } = await context.supabase
      .from("claim_document_requests")
      .delete()
      .eq("id", data.requestId)
      .is("fulfilled_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!deleted?.length) unprocessable("This request was already fulfilled or no longer exists");
    return { ok: true };
  });
