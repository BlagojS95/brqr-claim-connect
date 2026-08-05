-- Per-claim contacts table (Broker Claims Contact / Adjuster / Attorney / Other x2)
-- plus an in-app log of "sent email" events used to drive the Correspondence
-- (Mailbox) popup and the Status Follow Up column. There is no real mailbox
-- integration here — `claim_contact_emails` only records events the app itself
-- logged (a Send Email click), it does not read anyone's actual inbox.

CREATE TABLE public.claim_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  row_key TEXT NOT NULL CHECK (row_key IN ('broker_claims_contact', 'adjuster', 'attorney', 'other_1', 'other_2')),
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (claim_id, row_key)
);

ALTER TABLE public.claim_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client sees own claim contacts" ON public.claim_contacts FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.claims cl
    JOIN public.clients c ON c.id = cl.client_id
    WHERE cl.id = claim_contacts.claim_id AND c.user_id = auth.uid()
  )
);
CREATE POLICY "client updates own claim contacts" ON public.claim_contacts FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.claims cl
    JOIN public.clients c ON c.id = cl.client_id
    WHERE cl.id = claim_contacts.claim_id AND c.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.claims cl
    JOIN public.clients c ON c.id = cl.client_id
    WHERE cl.id = claim_contacts.claim_id AND c.user_id = auth.uid()
  )
);
CREATE POLICY "admin all claim contacts" ON public.claim_contacts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'agency_admin'));

-- In-app "email sent" log, one row per Send Email / Send Follow Up click.
CREATE TABLE public.claim_contact_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_contact_id UUID NOT NULL REFERENCES public.claim_contacts(id) ON DELETE CASCADE,
  claim_id UUID NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_by UUID REFERENCES auth.users(id),
  subject TEXT,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.claim_contact_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client sees own claim contact emails" ON public.claim_contact_emails FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.claims cl
    JOIN public.clients c ON c.id = cl.client_id
    WHERE cl.id = claim_contact_emails.claim_id AND c.user_id = auth.uid()
  )
);
CREATE POLICY "client inserts own claim contact emails" ON public.claim_contact_emails FOR INSERT TO authenticated WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.claims cl
    JOIN public.clients c ON c.id = cl.client_id
    WHERE cl.id = claim_contact_emails.claim_id AND c.user_id = auth.uid()
  )
);
CREATE POLICY "client updates own claim contact emails" ON public.claim_contact_emails FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.claims cl
    JOIN public.clients c ON c.id = cl.client_id
    WHERE cl.id = claim_contact_emails.claim_id AND c.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.claims cl
    JOIN public.clients c ON c.id = cl.client_id
    WHERE cl.id = claim_contact_emails.claim_id AND c.user_id = auth.uid()
  )
);
CREATE POLICY "admin all claim contact emails" ON public.claim_contact_emails FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'agency_admin'));

-- Auto-seed the 5 fixed contact rows whenever a claim is created.
CREATE OR REPLACE FUNCTION public.seed_claim_contacts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.claim_contacts (claim_id, row_key)
  VALUES
    (NEW.id, 'broker_claims_contact'),
    (NEW.id, 'adjuster'),
    (NEW.id, 'attorney'),
    (NEW.id, 'other_1'),
    (NEW.id, 'other_2')
  ON CONFLICT (claim_id, row_key) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER seed_claim_contacts_on_insert
AFTER INSERT ON public.claims
FOR EACH ROW EXECUTE FUNCTION public.seed_claim_contacts();

-- Backfill for claims that already existed before this migration.
INSERT INTO public.claim_contacts (claim_id, row_key)
SELECT cl.id, rk.row_key
FROM public.claims cl
CROSS JOIN (VALUES ('broker_claims_contact'), ('adjuster'), ('attorney'), ('other_1'), ('other_2')) AS rk(row_key)
ON CONFLICT (claim_id, row_key) DO NOTHING;
