-- Loss details captured by the claim form (fixes 9-11). The form asks for a
-- different set depending on the line of business; every column is nullable
-- because imported claims and older portal claims don't have them.
--
-- For General Liability the third party's name goes in the existing
-- claimant_name column (already shown on the claim and in the contacts email);
-- their phone/email/address goes in third_party_contact.

ALTER TABLE public.claims
  -- Shared
  ADD COLUMN time_of_loss time,
  ADD COLUMN loss_location text,
  ADD COLUMN reporter_name text,
  ADD COLUMN reporter_phone text,
  ADD COLUMN reporter_email text,
  ADD COLUMN injuries boolean,
  -- Business Auto
  ADD COLUMN vehicles_involved text,
  ADD COLUMN driver_name text,
  ADD COLUMN police_report_number text,
  -- Workers Compensation
  ADD COLUMN employee_name text,
  ADD COLUMN employee_job_title text,
  ADD COLUMN injured_body_part text,
  ADD COLUMN date_reported_to_employer date,
  -- General Liability
  ADD COLUMN third_party_contact text;

-- The employer can't hear about an injury before it happened. Future dates are
-- rejected by submitClaim against the agency calendar, which a CHECK can't do.
ALTER TABLE public.claims
  ADD CONSTRAINT claims_reported_to_employer_after_loss
  CHECK (
    date_reported_to_employer IS NULL
    OR date_of_loss IS NULL
    OR date_reported_to_employer >= date_of_loss
  );

-- RLS on claims is unchanged: these are ordinary columns on rows the existing
-- policies already scope to the caller's client_id (or all rows for admins).
