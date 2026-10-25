-- Changes from the Oct 23 2026 feedback meeting.

-- Claimant name lives on the claim itself; it goes into email subject lines.
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS claimant_name text;

-- One internal note per claim, agency staff only. Kept out of claims so a
-- client can't read it through their own claims rows.
CREATE TABLE IF NOT EXISTS public.claim_internal_notes (
  claim_id uuid PRIMARY KEY REFERENCES public.claims(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES auth.users(id),
  updated_by_email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.claim_internal_notes TO authenticated;
GRANT ALL ON public.claim_internal_notes TO service_role;

ALTER TABLE public.claim_internal_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all claim internal notes" ON public.claim_internal_notes FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'agency_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'agency_admin'::app_role));

-- The client upload policy compared the path against clients.name instead of
-- objects.name (unqualified "name" resolved to the inner table), so every
-- client upload was rejected with a 400.
DROP POLICY IF EXISTS "owner or admin upload claim docs" ON storage.objects;
CREATE POLICY "owner or admin upload claim docs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'claim-documents'
  AND (
    has_role(auth.uid(), 'agency_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.user_id = auth.uid()
        AND c.id::text = split_part(objects.name, '/', 1)
    )
  )
);
