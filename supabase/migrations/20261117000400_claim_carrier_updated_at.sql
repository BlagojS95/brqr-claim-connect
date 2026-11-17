-- Data freshness (fix 62): when a claim's carrier-held details (claim number,
-- status, paid, reserve, adjuster) were last confirmed or changed, either by
-- an agency admin in quick edit or by a carrier import. Null until then.
-- claims already has RLS; this adds a column only.

ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS carrier_updated_at timestamptz;
