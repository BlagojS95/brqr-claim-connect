ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS closed_date date;

CREATE TABLE IF NOT EXISTS public.claim_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  row_key text NOT NULL,
  contact_person text,
  phone text,
  email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (claim_id, row_key)
);

CREATE TABLE IF NOT EXISTS public.claim_contact_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_contact_id uuid NOT NULL REFERENCES public.claim_contacts(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  sent_by uuid REFERENCES auth.users(id),
  subject text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  replied_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.claim_contacts TO authenticated;
GRANT ALL ON public.claim_contacts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.claim_contact_emails TO authenticated;
GRANT ALL ON public.claim_contact_emails TO service_role;

ALTER TABLE public.claim_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_contact_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all claim contacts" ON public.claim_contacts FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'agency_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'agency_admin'::app_role));

CREATE POLICY "client manages own claim contacts" ON public.claim_contacts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.claims cl JOIN public.clients c ON c.id = cl.client_id WHERE cl.id = claim_contacts.claim_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.claims cl JOIN public.clients c ON c.id = cl.client_id WHERE cl.id = claim_contacts.claim_id AND c.user_id = auth.uid()));

CREATE POLICY "admin all claim contact emails" ON public.claim_contact_emails FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'agency_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'agency_admin'::app_role));

CREATE POLICY "client manages own claim contact emails" ON public.claim_contact_emails FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.claims cl JOIN public.clients c ON c.id = cl.client_id WHERE cl.id = claim_contact_emails.claim_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.claims cl JOIN public.clients c ON c.id = cl.client_id WHERE cl.id = claim_contact_emails.claim_id AND c.user_id = auth.uid()));

-- default contact rows for existing and future claims
INSERT INTO public.claim_contacts (claim_id, row_key)
SELECT c.id, k
FROM public.claims c
CROSS JOIN (VALUES ('broker_claims_contact'),('adjuster'),('attorney'),('other_1'),('other_2')) AS t(k)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_claim_contacts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.claim_contacts (claim_id, row_key)
  SELECT NEW.id, k
  FROM (VALUES ('broker_claims_contact'),('adjuster'),('attorney'),('other_1'),('other_2')) AS t(k)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_claim_contacts_trigger ON public.claims;
CREATE TRIGGER seed_claim_contacts_trigger
AFTER INSERT ON public.claims
FOR EACH ROW EXECUTE FUNCTION public.seed_claim_contacts();