-- Phase 7 groundwork: fields shared by the staff tools (fixes 52, 53, 54, 56).
--
-- claims.assigned_to             staff member (agency_admin login) handling the
--                                claim; set from quick edit (fix 53), shown and
--                                filtered on the staff work queue (fix 52).
-- claims.submitted_to_carrier_at when the agency sent the claim to the carrier
--                                (quick edit, or the "First notice of loss"
--                                carrier email template, fix 54).
-- claims.first_carrier_contact_at when the carrier first got back to the agency
--                                (quick edit). Both drive the response targets
--                                in fix 56.
-- agency_settings.*_target_business_days: those targets, configurable.
-- claim_activity kind 'claim_update': a quick edit or import change, with the
--                                old and new values in the body.
--
-- Clients can't update claims under RLS, so all of these are written by server
-- functions after requireAgencyAdmin.

ALTER TABLE public.claims
  ADD COLUMN assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN submitted_to_carrier_at timestamptz,
  ADD COLUMN first_carrier_contact_at timestamptz;

CREATE INDEX claims_assigned_to_idx ON public.claims (assigned_to)
  WHERE assigned_to IS NOT NULL;

ALTER TABLE public.agency_settings
  ADD COLUMN submit_target_business_days smallint NOT NULL DEFAULT 1
    CHECK (submit_target_business_days BETWEEN 1 AND 30),
  ADD COLUMN first_contact_target_business_days smallint NOT NULL DEFAULT 3
    CHECK (first_contact_target_business_days BETWEEN 1 AND 30);

ALTER TABLE public.claim_activity DROP CONSTRAINT claim_activity_kind_check;
ALTER TABLE public.claim_activity ADD CONSTRAINT claim_activity_kind_check
  CHECK (kind IN ('created', 'status_change', 'document', 'email', 'follow_up', 'note', 'claim_update'));
