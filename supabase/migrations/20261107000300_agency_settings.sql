-- Agency-wide settings, kept in a single row. The Broker Claims Contact on every
-- claim's contacts table reads its email from here instead of a per-claim value,
-- so it is always the shared claims inbox rather than someone's personal address.

CREATE TABLE public.agency_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  broker_claims_email text NOT NULL DEFAULT 'claims@brqr.com',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agency_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_settings TO authenticated;

CREATE POLICY "signed-in users read agency settings" ON public.agency_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manages agency settings" ON public.agency_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'agency_admin'));

INSERT INTO public.agency_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
