// Server-only: sends the new-claim email and webhook. Reads with the service
// role, so callers must have checked access to the claim first.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { formatDate } from "@/lib/dates";
import type { DeliveryDeps, OutboxPatch } from "@/lib/claim-submission";

export const NAVY = "#0A2342";
const GOLD = "#C9A84C";
export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"];
function isImage(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmailHtml(opts: {
  isNotice: boolean;
  customerName: string;
  policyNumber: string;
  dateOfLoss: string;
  claimType: string;
  claimantName: string;
  description: string;
  documents: { file_name: string; file_url: string }[];
}): string {
  const {
    isNotice,
    customerName,
    policyNumber,
    dateOfLoss,
    claimType,
    claimantName,
    description,
    documents,
  } = opts;
  const title = isNotice ? "New Incident Notice" : "New Claim";

  const attachmentsHtml = documents.length
    ? documents
        .map((d) =>
          isImage(d.file_name)
            ? `<div style="margin:12px 0;"><img src="${escapeHtml(d.file_url)}" alt="${escapeHtml(d.file_name)}" style="max-width:100%;border-radius:6px;border:1px solid #E0E5EB;" /></div>`
            : `<div style="margin:8px 0;"><a href="${escapeHtml(d.file_url)}" style="color:${NAVY};text-decoration:underline;">${escapeHtml(d.file_name)}</a></div>`,
        )
        .join("")
    : `<p style="color:#5C646F;font-size:14px;margin:8px 0 0;">No documents attached.</p>`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#FAFCFE;font-family:${FONT_STACK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAFCFE;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border-radius:8px;overflow:hidden;border:1px solid #E0E5EB;">
            <tr>
              <td style="background-color:${NAVY};padding:24px 32px;">
                <span style="color:#F9FCFF;font-size:20px;font-weight:700;">BRQR Claims Portal</span>
                <div style="height:3px;width:48px;background-color:${GOLD};margin-top:10px;"></div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="color:${NAVY};font-size:20px;margin:0 0 16px;">${title}</h1>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                  <tr>
                    <td style="padding:6px 0;color:#5C646F;font-size:13px;width:140px;">Customer</td>
                    <td style="padding:6px 0;color:#0A1628;font-size:14px;font-weight:600;">${escapeHtml(customerName)}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#5C646F;font-size:13px;">Policy Number</td>
                    <td style="padding:6px 0;color:#0A1628;font-size:14px;">${escapeHtml(policyNumber || "—")}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#5C646F;font-size:13px;">Claim Type</td>
                    <td style="padding:6px 0;color:#0A1628;font-size:14px;">${escapeHtml(claimType || "—")}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#5C646F;font-size:13px;">Claimant</td>
                    <td style="padding:6px 0;color:#0A1628;font-size:14px;">${escapeHtml(claimantName || "—")}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#5C646F;font-size:13px;">Date of Loss</td>
                    <td style="padding:6px 0;color:#0A1628;font-size:14px;">${escapeHtml(dateOfLoss)}</td>
                  </tr>
                </table>
                <div style="border-top:1px solid #E0E5EB;padding-top:16px;">
                  <h2 style="color:${NAVY};font-size:14px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px;">Description</h2>
                  <p style="color:#0A1628;font-size:14px;line-height:1.6;white-space:pre-wrap;margin:0;">${escapeHtml(description || "—")}</p>
                </div>
                <div style="border-top:1px solid #E0E5EB;padding-top:16px;margin-top:20px;">
                  <h2 style="color:${NAVY};font-size:14px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px;">Attachments</h2>
                  ${attachmentsHtml}
                </div>
              </td>
            </tr>
            <tr>
              <td style="background-color:#EEF2F7;padding:16px 32px;text-align:center;">
                <span style="color:#5C646F;font-size:12px;">© BRQR Insurance Agency</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// All portal notifications go to the agency's shared service inbox unless the
// env var says otherwise. The sender must be on a domain verified in Resend;
// the resend.dev sandbox sender can only deliver to the Resend account owner.
const DEFAULT_RECIPIENT = "service@brqr.com";
const DEFAULT_SENDER = "BRQR Claims Portal <onboarding@resend.dev>";

export async function sendViaResend(subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY environment variable");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.NOTIFICATION_FROM_EMAIL || DEFAULT_SENDER,
      to: [process.env.CLAIM_NOTIFICATION_EMAIL || DEFAULT_RECIPIENT],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend request failed: ${res.status} ${await res.text()}`);
  }
}

async function loadClaimWithDocuments(claimId: string) {
  const { data: claim, error } = await supabaseAdmin
    .from("claims")
    .select("*, clients(name, company_name)")
    .eq("id", claimId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't load claim: ${error.message}`);
  if (!claim) throw new Error("Claim not found");

  const { data: docs, error: docsError } = await supabaseAdmin
    .from("documents")
    .select("file_name, file_url")
    .eq("claim_id", claimId);
  if (docsError) throw new Error(`Couldn't load documents: ${docsError.message}`);

  const clientRow = claim.clients as { name?: string; company_name?: string } | null;
  const customerName = clientRow?.company_name || clientRow?.name || "";
  return { claim, docs: docs ?? [], customerName };
}

export async function sendClaimEmail(claimId: string) {
  const { claim, docs, customerName: name } = await loadClaimWithDocuments(claimId);
  const customerName = name || "Unknown Customer";
  const dateOfLoss = formatDate(claim.date_of_loss);
  const subjectPrefix = claim.is_notice_only ? "New Incident Notice" : "New Claim";
  const policyNumber = claim.policy_number ?? "";
  const subject = `${subjectPrefix} - ${customerName}; ${policyNumber || "—"} ${dateOfLoss}`;

  const html = buildEmailHtml({
    isNotice: claim.is_notice_only,
    customerName,
    policyNumber,
    dateOfLoss,
    claimType: claim.claim_type,
    claimantName: claim.claimant_name ?? "",
    description: claim.description ?? "",
    documents: docs,
  });

  await sendViaResend(subject, html);
}

const NEW_CLAIM_WEBHOOK_URL = "https://n8n.brqr.com/webhook/new-claim";

export async function sendClaimWebhook(claimId: string) {
  const { claim, docs, customerName } = await loadClaimWithDocuments(claimId);
  const payload = {
    claim_id: claim.id,
    client_id: claim.client_id,
    client_name: customerName,
    policy_number: claim.policy_number ?? "",
    claim_type: claim.claim_type ?? "",
    date_of_loss: claim.date_of_loss ?? "",
    description: claim.description ?? "",
    carrier: claim.carrier ?? "",
    documents: docs,
  };

  const res = await fetch(NEW_CLAIM_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
}

async function updateOutbox(id: string, patch: OutboxPatch) {
  const { error } = await supabaseAdmin.from("notification_outbox").update(patch).eq("id", id);
  if (error) console.error("notification_outbox update failed", id, error.message);
}

export const outboxDeliveryDeps: DeliveryDeps = {
  updateOutbox,
  send: { email: sendClaimEmail, webhook: sendClaimWebhook },
};

export async function loadOutboxRows(claimId: string) {
  const { data, error } = await supabaseAdmin
    .from("notification_outbox")
    .select("id, claim_id, kind, status, attempts")
    .eq("claim_id", claimId);
  if (error) throw new Error(`Couldn't load notifications: ${error.message}`);
  return data ?? [];
}
