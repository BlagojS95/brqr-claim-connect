-- Signature on file: a client signs once (drawn signature + typed name +
-- consent) so the agency can apply it to loss run requests and carrier forms
-- without chasing them for a signature every time.
--
-- Rows are an audit trail: clients can add one but never edit or delete it.
-- The newest row without revoked_at is the active signature.
CREATE TABLE IF NOT EXISTS public.client_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  signer_name text NOT NULL,
  -- PNG in the claim-documents bucket under <client_id>/signature/
  signature_path text NOT NULL,
  consent_version text NOT NULL,
  consent_text text NOT NULL,
  signed_by uuid NOT NULL REFERENCES auth.users(id),
  signed_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS client_signatures_client_id_idx ON public.client_signatures (client_id, signed_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_signatures TO authenticated;
GRANT ALL ON public.client_signatures TO service_role;

ALTER TABLE public.client_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all client signatures" ON public.client_signatures FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'agency_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'agency_admin'::app_role));

CREATE POLICY "client reads own signatures" ON public.client_signatures FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_signatures.client_id AND c.user_id = auth.uid()));

CREATE POLICY "client signs for themselves" ON public.client_signatures FOR INSERT TO authenticated
  WITH CHECK (
    signed_by = auth.uid()
    AND revoked_at IS NULL
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_signatures.client_id AND c.user_id = auth.uid())
  );
