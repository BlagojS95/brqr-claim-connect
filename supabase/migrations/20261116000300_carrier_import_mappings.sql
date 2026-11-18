-- Carrier CSV import (fix 53): which column of a carrier's claim report holds
-- which claim field, saved once per carrier so the next upload from the same
-- carrier maps itself.
--
-- mapping is { "<field>": "<CSV column header>" } for the fields in
-- src/lib/carrier-import.ts (claim_number, status, paid_amount, ...).
--
-- Agency staff only: written by saveCarrierImportMapping
-- (src/lib/carrier-import.functions.ts) with the admin's own token after
-- requireAgencyAdmin, and RLS allows nobody else.

CREATE TABLE public.carrier_import_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier text NOT NULL UNIQUE CHECK (char_length(btrim(carrier)) BETWEEN 1 AND 200),
  mapping jsonb NOT NULL CHECK (jsonb_typeof(mapping) = 'object'),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.carrier_import_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads carrier import mappings" ON public.carrier_import_mappings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role));

CREATE POLICY "admin adds carrier import mappings" ON public.carrier_import_mappings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'agency_admin'::app_role));

CREATE POLICY "admin updates carrier import mappings" ON public.carrier_import_mappings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'agency_admin'::app_role));

CREATE POLICY "admin deletes carrier import mappings" ON public.carrier_import_mappings
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role));

REVOKE ALL ON public.carrier_import_mappings FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.carrier_import_mappings FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carrier_import_mappings TO authenticated;
GRANT ALL ON public.carrier_import_mappings TO service_role;
