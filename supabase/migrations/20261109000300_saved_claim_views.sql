-- Saved views on the claims list (fix 31): a user names the current search and
-- filters, and the view shows as a tab above the list. Each user sees only
-- their own views. filters holds the claims-list search params
-- (q, status, line, year, carrier, location, sort, dir), parsed by the app.

CREATE TABLE public.saved_claim_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE public.saved_claim_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own saved views" ON public.saved_claim_views
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.saved_claim_views FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_claim_views TO authenticated;
GRANT ALL ON public.saved_claim_views TO service_role;
