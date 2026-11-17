-- Fix 51: access log. Who signed in, opened a claim, changed one or downloaded
-- a report, and when.
--
-- Written only by the server with the service role (src/lib/access-log.server.ts),
-- never by the browser: no write policies and no write grants. Reads:
--   * agency staff read every row;
--   * a client's client_admin reads that client's rows (Settings > Activity);
--   * nobody else reads anything.
-- Apply after 20261117000500_require_mfa.sql (this table gets that policy here).

CREATE TABLE public.access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The client the action concerns: the claim's client, or the user's company
  -- for a sign-in. Null for agency staff signing in.
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action ~ '^[a-z_]{1,40}$'),
  claim_id uuid REFERENCES public.claims(id) ON DELETE SET NULL,
  detail text CHECK (char_length(detail) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX access_log_client_idx ON public.access_log (client_id, created_at DESC);
CREATE INDEX access_log_created_idx ON public.access_log (created_at DESC);

ALTER TABLE public.access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency admins and client admins read the access log"
  ON public.access_log FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'agency_admin'::app_role)
    OR (client_id IS NOT NULL AND public.is_client_admin(client_id))
  );

REVOKE ALL ON public.access_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.access_log FROM authenticated;
GRANT SELECT ON public.access_log TO authenticated;

-- View as client (fix 55): no writes, and only the viewed client's rows.
CREATE POLICY "view as client: no insert" ON public.access_log
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.viewing_as_client(auth.uid())) IS NULL);
CREATE POLICY "view as client: no update" ON public.access_log
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT public.viewing_as_client(auth.uid())) IS NULL)
  WITH CHECK ((SELECT public.viewing_as_client(auth.uid())) IS NULL);
CREATE POLICY "view as client: no delete" ON public.access_log
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.viewing_as_client(auth.uid())) IS NULL);
CREATE POLICY "view as client: only that client" ON public.access_log
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    CASE WHEN (SELECT public.viewing_as_client(auth.uid())) IS NULL THEN true
         ELSE client_id = (SELECT public.viewing_as_client(auth.uid()))
    END
  );

-- Two-step sign-in (20261117000500): nothing until the second step is passed.
CREATE POLICY "two-step sign-in" ON public.access_log
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.mfa_satisfied()))
  WITH CHECK ((SELECT public.mfa_satisfied()));
