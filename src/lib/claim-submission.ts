// Claim submission and notification delivery, kept free of Supabase and
// TanStack imports so it can be unit tested. The server functions in
// claim-submission.functions.ts wire these up to the database and senders.
import { z } from "zod";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";

export const NOTIFICATION_KINDS = ["email", "webhook"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type OutboxStatus = "pending" | "sent" | "failed";

export const MAX_NOTIFICATION_ATTEMPTS = 5;

// Wait before attempt n+1: 0.5s, 1s, 2s, 4s.
export function backoffMs(attempt: number): number {
  return 500 * 2 ** (attempt - 1);
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const SubmitClaimSchema = z.object({
  // Generated in the browser so files can be uploaded under
  // <client_id>/<claim_id>/ before the claim row exists.
  claimId: z.string().uuid(),
  clientId: z.string().uuid(),
  lineOfBusinessId: z.string().uuid(),
  policyId: z.string().uuid().nullable(),
  isNotice: z.boolean(),
  dateOfLoss: isoDate,
  claimantName: z.string().trim().max(200).nullable(),
  description: z.string().trim().min(1, "Description is required").max(10000),
  documents: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        fileName: z.string().min(1).max(255),
      }),
    )
    .max(50),
});
export type SubmitClaimInput = z.infer<typeof SubmitClaimSchema>;

export interface ClaimInsert {
  id: string;
  client_id: string;
  policy_id: string | null;
  policy_number: string | null;
  claim_type: string;
  claimant_name: string | null;
  line_of_business_id: string;
  line_of_business_description: string;
  is_notice_only: boolean;
  date_of_loss: string;
  date_reported: string;
  description: string;
  carrier: string | null;
  status: ClaimStatus;
}

export interface DocumentInsert {
  claim_id: string;
  client_id: string;
  file_name: string;
  file_url: string;
}

export interface SubmitClaimDeps {
  // Agency calendar date; the column default is CURRENT_DATE in UTC, a day ahead on US evenings.
  today(): string;
  // Throws unless the caller is an agency admin or the login linked to clientId.
  assertCanSubmitFor(clientId: string): Promise<void>;
  getLine(id: string): Promise<{ id: string; name: string } | null>;
  getPolicy(
    id: string,
    clientId: string,
  ): Promise<{ id: string; policy_number: string; carrier: string | null } | null>;
  signDocumentUrl(path: string): Promise<string>;
  insertClaim(row: ClaimInsert): Promise<{ id: string }>;
  insertDocuments(rows: DocumentInsert[]): Promise<void>;
  insertOutbox(rows: { claim_id: string; kind: NotificationKind }[]): Promise<void>;
  // Used to undo a half-saved claim (documents and outbox rows cascade).
  deleteClaim(id: string): Promise<void>;
}

export async function submitClaimCore(input: SubmitClaimInput, deps: SubmitClaimDeps) {
  await deps.assertCanSubmitFor(input.clientId);

  const line = await deps.getLine(input.lineOfBusinessId);
  if (!line) throw new Error("Unknown line of business");

  const policy = input.policyId ? await deps.getPolicy(input.policyId, input.clientId) : null;
  if (input.policyId && !policy) throw new Error("That policy doesn't belong to this client");

  // Storage RLS keys on the first path segment; keep documents inside this claim's folder.
  const prefix = `${input.clientId}/${input.claimId}/`;
  for (const doc of input.documents) {
    if (!doc.path.startsWith(prefix) || doc.path.includes("..")) {
      throw new Error(`Invalid document path for ${doc.fileName}`);
    }
  }

  const claim = await deps.insertClaim({
    id: input.claimId,
    client_id: input.clientId,
    policy_id: policy?.id ?? null,
    policy_number: policy?.policy_number ?? null,
    claim_type: line.name,
    claimant_name: input.claimantName || null,
    line_of_business_id: line.id,
    line_of_business_description: line.name,
    is_notice_only: input.isNotice,
    date_of_loss: input.dateOfLoss,
    date_reported: deps.today(),
    description: input.description,
    carrier: policy?.carrier ?? null,
    status: input.isNotice ? CLAIM_STATUS.notice : CLAIM_STATUS.submitted,
  });

  try {
    if (input.documents.length) {
      const rows: DocumentInsert[] = [];
      for (const doc of input.documents) {
        rows.push({
          claim_id: claim.id,
          client_id: input.clientId,
          file_name: doc.fileName,
          file_url: await deps.signDocumentUrl(doc.path),
        });
      }
      await deps.insertDocuments(rows);
    }
    await deps.insertOutbox(NOTIFICATION_KINDS.map((kind) => ({ claim_id: claim.id, kind })));
  } catch (err) {
    // Without its outbox rows nobody would hear about the claim, so don't keep it.
    await deps.deleteClaim(claim.id).catch(() => undefined);
    throw err;
  }

  return { claimId: claim.id };
}

export interface OutboxRow {
  id: string;
  claim_id: string;
  kind: string;
  status: string;
  attempts: number;
}

export interface OutboxPatch {
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
}

export interface DeliveryDeps {
  updateOutbox(id: string, patch: OutboxPatch): Promise<void>;
  send: Record<NotificationKind, (claimId: string) => Promise<void>>;
  sleep?: (ms: number) => Promise<void>;
}

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 2000);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Sends one outbox row, retrying until it succeeds or reaches the attempt cap.
// Every attempt is recorded so a crash mid-way leaves an accurate count.
export async function deliverOutboxRow(row: OutboxRow, deps: DeliveryDeps): Promise<OutboxStatus> {
  const send = deps.send[row.kind as NotificationKind];
  const sleep = deps.sleep ?? defaultSleep;
  if (!send) {
    await deps.updateOutbox(row.id, {
      status: "failed",
      attempts: row.attempts,
      last_error: `Unknown notification kind: ${row.kind}`,
    });
    return "failed";
  }

  for (let attempt = row.attempts + 1; attempt <= MAX_NOTIFICATION_ATTEMPTS; attempt++) {
    try {
      await send(row.claim_id);
      await deps.updateOutbox(row.id, { status: "sent", attempts: attempt, last_error: null });
      return "sent";
    } catch (err) {
      const last = attempt >= MAX_NOTIFICATION_ATTEMPTS;
      await deps.updateOutbox(row.id, {
        status: last ? "failed" : "pending",
        attempts: attempt,
        last_error: errorMessage(err),
      });
      if (last) return "failed";
      await sleep(backoffMs(attempt));
    }
  }

  // Row already used up its attempts before this run.
  await deps.updateOutbox(row.id, {
    status: "failed",
    attempts: row.attempts,
    last_error: "Retry limit reached",
  });
  return "failed";
}

// Email and webhook are independent, so send them side by side.
export async function deliverPendingRows(rows: OutboxRow[], deps: DeliveryDeps) {
  const pending = rows.filter((r) => r.status === "pending");
  const results = await Promise.all(pending.map((r) => deliverOutboxRow(r, deps)));
  return pending.map((r, i) => ({ id: r.id, kind: r.kind, status: results[i] }));
}
