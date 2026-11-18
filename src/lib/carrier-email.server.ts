// Server-only: sends a carrier email (fix 54) and records it on the claim.
// Uses the service role, so the caller must have checked the agency_admin role
// (sendCarrierEmail in carrier-email.functions.ts does, via requireAgencyAdmin).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { escapeHtml, FONT_STACK, sendViaResend } from "@/lib/claim-notifications.server";
import { CLAIM_ACTIVITY_KIND } from "@/lib/claim-activity";
import { carrierEmailActivityBody, EMAIL_TEMPLATE_KEY } from "@/lib/email-templates";

/** The plain-text body as simple HTML: escaped, line breaks kept. */
export function carrierEmailHtml(body: string): string {
  const content = escapeHtml(body).replace(/\r?\n/g, "<br>\n");
  return `<!doctype html>
<html>
  <body style="margin:0;padding:16px;font-family:${FONT_STACK};font-size:14px;line-height:1.5;color:#0A1628;">
    <div>${content}</div>
  </body>
</html>`;
}

export interface CarrierEmailInput {
  claimId: string;
  templateId: string;
  to: string;
  subject: string;
  body: string;
  /** The signed-in staff member sending it; recorded as the activity actor. */
  actorId: string;
}

export interface CarrierEmailResult {
  /** False if the email went out but the activity entry couldn't be written. */
  logged: boolean;
  /** True if this send set claims.submitted_to_carrier_at. */
  markedSubmitted: boolean;
}

export async function deliverCarrierEmail(input: CarrierEmailInput): Promise<CarrierEmailResult> {
  const { data: template, error: templateError } = await supabaseAdmin
    .from("email_templates")
    .select("id, key, name")
    .eq("id", input.templateId)
    .maybeSingle();
  if (templateError) throw new Error(`Couldn't load the template: ${templateError.message}`);
  if (!template) throw new Error("That email template no longer exists");

  const { data: claim, error: claimError } = await supabaseAdmin
    .from("claims")
    .select("id, submitted_to_carrier_at")
    .eq("id", input.claimId)
    .maybeSingle();
  if (claimError) throw new Error(`Couldn't load the claim: ${claimError.message}`);
  if (!claim) throw new Error("Claim not found");

  const { data: settings } = await supabaseAdmin
    .from("agency_settings")
    .select("broker_claims_email")
    .eq("id", 1)
    .maybeSingle();
  const replyTo = settings?.broker_claims_email?.trim() || undefined;

  // A failed send throws here, before anything is recorded.
  await sendViaResend(input.subject, carrierEmailHtml(input.body), {
    to: input.to,
    text: input.body,
    replyTo,
  });

  // The email is out; recording it must not turn the send into an error.
  const { error: activityError } = await supabaseAdmin.from("claim_activity").insert({
    claim_id: claim.id,
    actor_id: input.actorId,
    kind: CLAIM_ACTIVITY_KIND.email,
    body: carrierEmailActivityBody(input.to, template.name, input.subject),
  });
  if (activityError) {
    console.error("claim_activity insert failed", claim.id, activityError.message);
  }

  let markedSubmitted = false;
  if (template.key === EMAIL_TEMPLATE_KEY.firstNoticeOfLoss && !claim.submitted_to_carrier_at) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("claims")
      .update({ submitted_to_carrier_at: new Date().toISOString() })
      .eq("id", claim.id)
      .is("submitted_to_carrier_at", null)
      .select("id");
    if (updateError) {
      console.error("submitted_to_carrier_at update failed", claim.id, updateError.message);
    } else {
      markedSubmitted = (updated ?? []).length > 0;
    }
  }

  return { logged: !activityError, markedSubmitted };
}
