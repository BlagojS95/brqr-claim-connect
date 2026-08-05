ALTER TABLE public.claim_contacts DROP CONSTRAINT IF EXISTS claim_contacts_claim_id_fkey;
ALTER TABLE public.claim_contact_emails DROP CONSTRAINT IF EXISTS claim_contact_emails_claim_id_fkey;

ALTER TABLE public.claim_contacts ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

UPDATE public.claim_contacts cc
SET client_id = cl.client_id
FROM public.claims cl
WHERE cl.id = cc.claim_id AND cc.client_id IS NULL;

DROP POLICY IF EXISTS "client sees own claim contacts" ON public.claim_contacts;
DROP POLICY IF EXISTS "client updates own claim contacts" ON public.claim_contacts;
DROP POLICY IF EXISTS "client manages own claim contacts" ON public.claim_contacts;

CREATE POLICY "client manages own claim contacts" ON public.claim_contacts FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.clients c WHERE c.id = claim_contacts.client_id AND c.user_id = auth.uid())
);
CREATE POLICY "client updates own claim contacts" ON public.claim_contacts FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.clients c WHERE c.id = claim_contacts.client_id AND c.user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.clients c WHERE c.id = claim_contacts.client_id AND c.user_id = auth.uid())
);

DROP POLICY IF EXISTS "client sees own claim contact emails" ON public.claim_contact_emails;
DROP POLICY IF EXISTS "client inserts own claim contact emails" ON public.claim_contact_emails;
DROP POLICY IF EXISTS "client updates own claim contact emails" ON public.claim_contact_emails;
DROP POLICY IF EXISTS "client manages own claim contact emails" ON public.claim_contact_emails;

CREATE POLICY "client sees own claim contact emails" ON public.claim_contact_emails FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.claim_contacts cc
    JOIN public.clients c ON c.id = cc.client_id
    WHERE cc.id = claim_contact_emails.claim_contact_id AND c.user_id = auth.uid()
  )
);
CREATE POLICY "client inserts own claim contact emails" ON public.claim_contact_emails FOR INSERT TO authenticated WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.claim_contacts cc
    JOIN public.clients c ON c.id = cc.client_id
    WHERE cc.id = claim_contact_emails.claim_contact_id AND c.user_id = auth.uid()
  )
);
CREATE POLICY "client updates own claim contact emails" ON public.claim_contact_emails FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.claim_contacts cc
    JOIN public.clients c ON c.id = cc.client_id
    WHERE cc.id = claim_contact_emails.claim_contact_id AND c.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.claim_contacts cc
    JOIN public.clients c ON c.id = cc.client_id
    WHERE cc.id = claim_contact_emails.claim_contact_id AND c.user_id = auth.uid()
  )
);

CREATE OR REPLACE FUNCTION public.seed_claim_contacts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.claim_contacts (claim_id, row_key, client_id)
  SELECT NEW.id, k, NEW.client_id
  FROM (VALUES ('broker_claims_contact'), ('adjuster'), ('attorney'), ('other_1'), ('other_2')) AS t(k)
  ON CONFLICT (claim_id, row_key) DO NOTHING;
  RETURN NEW;
END;
$$;