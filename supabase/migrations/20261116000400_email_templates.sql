-- Carrier email templates (fix 54). Agency staff pick one on a claim's
-- "Email carrier" dialog; {placeholders} are filled from the claim by
-- src/lib/email-templates.ts, staff can edit the result, and the send is
-- logged to claim_activity (kind 'email') by the server.
--
-- key marks the seeded templates the app knows by name: sending
-- 'first_notice_of_loss' sets claims.submitted_to_carrier_at (fix 56).
-- Templates staff add themselves have no key.
--
-- Staff only: clients never see or use these, so every policy requires the
-- agency_admin role.

CREATE TABLE public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 300),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 20000),
  sort_order integer NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads email templates" ON public.email_templates
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role));

CREATE POLICY "admin adds email templates" ON public.email_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'agency_admin'::app_role));

CREATE POLICY "admin updates email templates" ON public.email_templates
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'agency_admin'::app_role));

CREATE POLICY "admin deletes email templates" ON public.email_templates
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role));

REVOKE ALL ON public.email_templates FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_templates TO authenticated;
GRANT ALL ON public.email_templates TO service_role;

-- Bodies are dollar-quoted so their line breaks are real newlines.
INSERT INTO public.email_templates (key, name, subject, body, sort_order) VALUES
(
  'first_notice_of_loss',
  'First notice of loss',
  'First Notice of Loss - {insured} - Policy {policy_number} - DOL {date_of_loss}',
  $body$Hello,

Please accept this as first notice of loss on behalf of our insured, {insured}.

Insured: {insured}
Carrier: {carrier}
Policy number: {policy_number}
Line of business: {line_of_business}
Date of loss: {date_of_loss}
Loss location: {loss_location}
Claimant: {claimant_name}

Description of loss:
{description}

Please confirm receipt, set up the claim and send us the claim number and the assigned adjuster's contact details. Reply to this email or write to {broker_claims_email} with any questions.

Thank you,
BRQR Insurance Agency
{broker_claims_email}$body$,
  10
),
(
  'status_request',
  'Status request',
  'Status Request - Claim {claim_number} - {insured} - DOL {date_of_loss}',
  $body$Hello {adjuster_name},

We are following up on behalf of our insured, {insured}, for a status update on the claim below.

Claim number: {claim_number}
Policy number: {policy_number}
Date of loss: {date_of_loss}
Claimant: {claimant_name}

Could you please let us know where the claim stands, including the current reserve, any payments issued, and the next steps and expected timing?

Thank you,
BRQR Insurance Agency
{broker_claims_email}$body$,
  20
),
(
  'document_follow_up',
  'Document follow-up',
  'Documents - Claim {claim_number} - {insured} - DOL {date_of_loss}',
  $body$Hello {adjuster_name},

We are following up on documents for the claim below on behalf of our insured, {insured}.

Claim number: {claim_number}
Policy number: {policy_number}
Date of loss: {date_of_loss}
Claimant: {claimant_name}

Please let us know whether you still need anything from the insured to move the claim forward, or confirm that you have received the documents already provided.

Thank you,
BRQR Insurance Agency
{broker_claims_email}$body$,
  30
)
ON CONFLICT (key) DO NOTHING;
