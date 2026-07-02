
-- Add AMS360 sync columns to claims table.
-- ams360_claim_id is the upsert key: the external pipeline uses
-- onConflict('ams360_claim_id') to update rather than duplicate on re-sync.
-- ams360_closs_hist_id stored for traceability (no unique constraint —
-- swap to the unique index target if one ClaimId ever produces multiple rows).
ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS ams360_claim_id text,
  ADD COLUMN IF NOT EXISTS ams360_closs_hist_id text,
  ADD COLUMN IF NOT EXISTS line_of_business text,
  ADD COLUMN IF NOT EXISTS line_of_business_description text,
  ADD COLUMN IF NOT EXISTS closed_date timestamptz;

-- Partial unique index: enforces one row per AMS360 claim while allowing
-- legacy/manual rows with NULL to coexist without conflict.
CREATE UNIQUE INDEX IF NOT EXISTS claims_ams360_claim_id_key
  ON public.claims (ams360_claim_id)
  WHERE ams360_claim_id IS NOT NULL;
