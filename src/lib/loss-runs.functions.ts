import { LOSS_RUN_REQUEST_STATUS } from "@/lib/loss-run-request-status";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseInput, unprocessable } from "@/lib/http-errors.server";
import { requireAgencyAdmin } from "@/integrations/supabase/require-agency-admin.server";
import { isLossRunPathFor, lossRunPath } from "@/lib/loss-run-files";

const BUCKET = "claim-documents";

const UploadSchema = z.object({
  clientId: z.string().uuid(),
  fileName: z.string().trim().min(1, "Choose a file first").max(255),
});

const AttachSchema = z.object({
  clientId: z.string().uuid(),
  year: z.number().int().min(1900).max(2100),
  path: z.string().min(1).max(1024),
});

const RequestIdSchema = z.object({ requestId: z.string().uuid() });

// Admin "Add Loss Run", step 1: the server picks the storage path and returns
// a one-time signed upload URL for it. Clients may write under their own
// folder in this bucket, so the path must not come from the browser.
export const createLossRunUpload = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(UploadSchema))
  .handler(async ({ data, context }) => {
    const { data: client, error: clientError } = await context.supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (clientError) throw new Error(clientError.message);
    if (!client) throw new Error("Client not found");

    const path = lossRunPath(client.id, data.fileName);
    const { data: signed, error } = await context.supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Couldn't start the upload");
    return { path: signed.path, token: signed.token };
  });

// Step 2, once the file is uploaded: record it in loss_runs. If the insert
// fails the uploaded file is removed again.
export const attachLossRun = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(AttachSchema))
  .handler(async ({ data, context }) => {
    if (!isLossRunPathFor(data.clientId, data.path)) {
      unprocessable("Invalid loss run file path");
    }
    const { error } = await context.supabase.from("loss_runs").insert({
      client_id: data.clientId,
      year: data.year,
      document_url: data.path,
    });
    if (error) {
      await context.supabase.storage.from(BUCKET).remove([data.path]);
      throw new Error(error.message);
    }
    return { ok: true };
  });

// "Mark fulfilled" on the admin Loss Run Requests table.
export const fulfillLossRunRequest = createServerFn({ method: "POST" })
  .middleware([requireAgencyAdmin])
  .inputValidator(parseInput(RequestIdSchema))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("loss_run_requests")
      .update({ status: LOSS_RUN_REQUEST_STATUS.fulfilled, fulfilled_at: new Date().toISOString() })
      .eq("id", data.requestId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Loss run request not found");
    return { ok: true };
  });
