-- Cause of loss (fix 35): a lookup table like lines_of_business, picked on the
-- report form and used by the Insights "claims by cause" chart. Names live in
-- the table; the app reads them, never hard-codes them.

CREATE TABLE public.causes_of_loss (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true
);

ALTER TABLE public.causes_of_loss ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signed-in users read causes of loss" ON public.causes_of_loss
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manages causes of loss" ON public.causes_of_loss
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'agency_admin'::app_role));

REVOKE ALL ON public.causes_of_loss FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.causes_of_loss TO authenticated;
GRANT ALL ON public.causes_of_loss TO service_role;

INSERT INTO public.causes_of_loss (name, sort_order) VALUES
  ('Vehicle collision', 10),
  ('Slip, trip or fall', 20),
  ('Lifting or strain', 30),
  ('Struck by object', 40),
  ('Cut or laceration', 50),
  ('Equipment or machinery', 60),
  ('Fire or smoke', 70),
  ('Water damage', 80),
  ('Wind, hail or weather', 90),
  ('Theft or burglary', 100),
  ('Vandalism', 110),
  ('Product or completed work', 120),
  ('Other', 999);

ALTER TABLE public.claims
  ADD COLUMN cause_of_loss_id uuid REFERENCES public.causes_of_loss(id) ON DELETE SET NULL;

CREATE INDEX claims_cause_of_loss_idx ON public.claims (cause_of_loss_id);
