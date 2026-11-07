// Claim submission and notification delivery, kept free of Supabase and
// TanStack imports so it can be unit tested. The server functions in
// claim-submission.functions.ts wire these up to the database and senders.
import { z } from "zod";
import { CLAIM_STATUS, type ClaimStatus } from "@/lib/claim-status";
import { formatDate } from "@/lib/dates";
import { unprocessableError } from "@/lib/http-errors";
import { LINE_OF_BUSINESS } from "@/lib/line-of-business";
import { policyCoversLoss, type PolicyTerm } from "@/lib/policy-match";

export const NOTIFICATION_KINDS = ["email", "webhook"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export const OUTBOX_STATUSES = ["pending", "sent", "failed"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];
/** notification_outbox.status values (CHECK constraint in the notification_outbox migration). */
export const OUTBOX_STATUS = {
  pending: "pending",
  sent: "sent",
  failed: "failed",
} as const satisfies Record<OutboxStatus, OutboxStatus>;

export const MAX_NOTIFICATION_ATTEMPTS = 5;

// Wait before attempt n+1: 0.5s, 1s, 2s, 4s.
export function backoffMs(attempt: number): number {
  return 500 * 2 ** (attempt - 1);
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
const optionalText = (max: number) => z.string().trim().max(max).nullish();

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
  // Loss details. Which of the line-specific ones are kept depends on the line
  // of business; see lossDetailsFor.
  timeOfLoss: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use an HH:MM time")
    .nullish(),
  lossLocation: optionalText(500),
  reporterName: optionalText(200),
  reporterPhone: optionalText(50),
  reporterEmail: z.string().trim().max(254).email("Enter a valid reporter email").nullish(),
  injuries: z.boolean().nullish(),
  vehiclesInvolved: optionalText(2000),
  driverName: optionalText(200),
  policeReportNumber: optionalText(100),
  employeeName: optionalText(200),
  employeeJobTitle: optionalText(200),
  injuredBodyPart: optionalText(200),
  dateReportedToEmployer: isoDate.nullish(),
  thirdPartyContact: optionalText(500),
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

export interface LossDetails {
  time_of_loss: string | null;
  loss_location: string | null;
  reporter_name: string | null;
  reporter_phone: string | null;
  reporter_email: string | null;
  injuries: boolean | null;
  vehicles_involved: string | null;
  driver_name: string | null;
  police_report_number: string | null;
  employee_name: string | null;
  employee_job_title: string | null;
  injured_body_part: string | null;
  date_reported_to_employer: string | null;
  third_party_contact: string | null;
}

// The shared loss details plus only the fields that belong to this line, so
// values left over from switching lines in the form are never saved.
export function lossDetailsFor(input: SubmitClaimInput, lineCode: string | null): LossDetails {
  const text = (v: string | null | undefined) => v?.trim() || null;
  const isAuto = lineCode === LINE_OF_BUSINESS.auto;
  const isWc = lineCode === LINE_OF_BUSINESS.workersComp;
  const isGl = lineCode === LINE_OF_BUSINESS.generalLiability;
  return {
    time_of_loss: input.timeOfLoss || null,
    loss_location: text(input.lossLocation),
    reporter_name: text(input.reporterName),
    reporter_phone: text(input.reporterPhone),
    reporter_email: text(input.reporterEmail),
    injuries: input.injuries ?? null,
    vehicles_involved: isAuto ? text(input.vehiclesInvolved) : null,
    driver_name: isAuto ? text(input.driverName) : null,
    police_report_number: isAuto ? text(input.policeReportNumber) : null,
    employee_name: isWc ? text(input.employeeName) : null,
    employee_job_title: isWc ? text(input.employeeJobTitle) : null,
    injured_body_part: isWc ? text(input.injuredBodyPart) : null,
    date_reported_to_employer: isWc ? input.dateReportedToEmployer || null : null,
    third_party_contact: isGl ? text(input.thirdPartyContact) : null,
  };
}

/**
 * The form's date and line rules, checked again on the server. Returns the
 * first problem as a message for the user, or null when the claim is valid.
 * Dates are "YYYY-MM-DD" text, which compares in calendar order.
 */
export function claimRuleError(
  input: SubmitClaimInput,
  ctx: { lineCode: string | null; today: string },
): string | null {
  if (input.dateOfLoss > ctx.today) return "Date of loss can't be in the future";
  if (ctx.lineCode === LINE_OF_BUSINESS.generalLiability) {
    if (!input.claimantName?.trim()) return "Third-party name is required for General Liability";
    if (!input.thirdPartyContact?.trim()) {
      return "Third-party contact is required for General Liability";
    }
  }
  if (ctx.lineCode === LINE_OF_BUSINESS.workersComp && input.dateReportedToEmployer) {
    if (input.dateReportedToEmployer > ctx.today) {
      return "Date reported to employer can't be in the future";
    }
    if (input.dateReportedToEmployer < input.dateOfLoss) {
      return "Date reported to employer can't be before the date of loss";
    }
  }
  return null;
}

export interface ClaimInsert extends LossDetails {
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
  getLine(id: string): Promise<{ id: string; name: string; code: string } | null>;
  getPolicy(
    id: string,
    clientId: string,
  ): Promise<({ id: string; policy_number: string; carrier: string | null } & PolicyTerm) | null>;
  signDocumentUrl(path: string): Promise<string>;
  insertClaim(row: ClaimInsert): Promise<{ id: string }>;
  insertDocuments(rows: DocumentInsert[]): Promise<void>;
  insertOutbox(rows: { claim_id: string; kind: NotificationKind }[]): Promise<void>;
  // Which notifications to queue. Defaults to all; the webhook is left out
  // while no CLAIM_WEBHOOK_URL is configured.
  notificationKinds?(): readonly NotificationKind[];
  // Used to undo a half-saved claim (documents and outbox rows cascade).
  deleteClaim(id: string): Promise<void>;
}

export async function submitClaimCore(input: SubmitClaimInput, deps: SubmitClaimDeps) {
  await deps.assertCanSubmitFor(input.clientId);

  const line = await deps.getLine(input.lineOfBusinessId);
  if (!line) throw unprocessableError("Unknown line of business");

  const today = deps.today();
  const ruleError = claimRuleError(input, { lineCode: line.code, today });
  if (ruleError) throw unprocessableError(ruleError);

  const policy = input.policyId ? await deps.getPolicy(input.policyId, input.clientId) : null;
  if (input.policyId && !policy) {
    throw unprocessableError("That policy doesn't belong to this client");
  }
  if (
    policy &&
    !policyCoversLoss(policy, { dateOfLoss: input.dateOfLoss, lineOfBusinessId: line.id })
  ) {
    throw unprocessableError(
      `Policy ${policy.policy_number} doesn't cover a ${line.name} loss on ${formatDate(input.dateOfLoss)}`,
    );
  }

  // Storage RLS keys on the first path segment; keep documents inside this claim's folder.
  const prefix = `${input.clientId}/${input.claimId}/`;
  for (const doc of input.documents) {
    if (!doc.path.startsWith(prefix) || doc.path.includes("..")) {
      throw unprocessableError(`Invalid document path for ${doc.fileName}`);
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
    date_reported: today,
    description: input.description,
    carrier: policy?.carrier ?? null,
    status: input.isNotice ? CLAIM_STATUS.notice : CLAIM_STATUS.submitted,
    ...lossDetailsFor(input, line.code),
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
    const kinds = deps.notificationKinds?.() ?? NOTIFICATION_KINDS;
    await deps.insertOutbox(kinds.map((kind) => ({ claim_id: claim.id, kind })));
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
      status: OUTBOX_STATUS.failed,
      attempts: row.attempts,
      last_error: `Unknown notification kind: ${row.kind}`,
    });
    return OUTBOX_STATUS.failed;
  }

  for (let attempt = row.attempts + 1; attempt <= MAX_NOTIFICATION_ATTEMPTS; attempt++) {
    try {
      await send(row.claim_id);
      await deps.updateOutbox(row.id, { status: OUTBOX_STATUS.sent, attempts: attempt, last_error: null });
      return OUTBOX_STATUS.sent;
    } catch (err) {
      const last = attempt >= MAX_NOTIFICATION_ATTEMPTS;
      await deps.updateOutbox(row.id, {
        status: last ? OUTBOX_STATUS.failed : OUTBOX_STATUS.pending,
        attempts: attempt,
        last_error: errorMessage(err),
      });
      if (last) return OUTBOX_STATUS.failed;
      await sleep(backoffMs(attempt));
    }
  }

  // Row already used up its attempts before this run.
  await deps.updateOutbox(row.id, {
    status: OUTBOX_STATUS.failed,
    attempts: row.attempts,
    last_error: "Retry limit reached",
  });
  return OUTBOX_STATUS.failed;
}

// Email and webhook are independent, so send them side by side.
export async function deliverPendingRows(rows: OutboxRow[], deps: DeliveryDeps) {
  const pending = rows.filter((r) => r.status === OUTBOX_STATUS.pending);
  const results = await Promise.all(pending.map((r) => deliverOutboxRow(r, deps)));
  return pending.map((r, i) => ({ id: r.id, kind: r.kind, status: results[i] }));
}
