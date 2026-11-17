-- Fix 51: two-step sign-in (TOTP) that a client can require.
--
-- Supabase Auth MFA does the enrolling and verifying; a session that has passed
-- the second step carries "aal": "aal2" in its JWT. clients.require_mfa is the
-- per-client switch (set by that client's client_admin or by agency staff,
-- through setClientRequireMfa in src/lib/security.functions.ts with the service
-- role; clients can't write the clients table themselves).
--
-- While a client requires it, its logins without aal2 get nothing:
--   * the server refuses every server function except the ones needed to enrol
--     and verify (requireSupabaseAuth, src/lib/mfa.server.ts);
--   * the database hides every row and storage object from them (RESTRICTIVE
--     policies below), so going around the server doesn't help either.
-- Agency staff are never required to (they have no client_users row, and
-- mfa_required() also answers false for agency_admin).
--
-- Apply this AFTER every other migration of the phase that creates a table:
-- the policy is added to each public table that exists when it runs.
-- scripts/rls-check.sql fails for any table that is missing it.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS require_mfa boolean NOT NULL DEFAULT false;

-- True when this user's company requires two-step sign-in. Only answers for the
-- caller's own id (or for the service role / SQL editor, which have no
-- auth.uid()); anyone else gets false.
CREATE OR REPLACE FUNCTION public.mfa_required(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.uid() IS NULL OR auth.uid() = _uid)
     AND NOT public.has_role(_uid, 'agency_admin'::app_role)
     AND EXISTS (
       SELECT 1
         FROM public.client_users cu
         JOIN public.clients c ON c.id = cu.client_id
        WHERE cu.user_id = _uid AND c.require_mfa
     )
$$;

REVOKE EXECUTE ON FUNCTION public.mfa_required(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mfa_required(uuid) TO authenticated, service_role;

-- For the policies: the caller has passed the second step, or doesn't need to.
CREATE OR REPLACE FUNCTION public.mfa_satisfied()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      OR auth.uid() IS NULL
      OR NOT public.mfa_required(auth.uid())
$$;

REVOKE EXECUTE ON FUNCTION public.mfa_satisfied() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mfa_satisfied() TO authenticated, service_role;

-- RESTRICTIVE: ANDed with the existing policies, so it only takes access away,
-- and only from a login whose company requires the second step and that hasn't
-- passed it. (SELECT ...) makes Postgres evaluate it once per statement.
DO $mfa$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "two-step sign-in" ON public.%I', t.relname);
    EXECUTE format(
      'CREATE POLICY "two-step sign-in" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()))',
      t.relname);
  END LOOP;
END
$mfa$;

DROP POLICY IF EXISTS "two-step sign-in" ON storage.objects;
CREATE POLICY "two-step sign-in" ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.mfa_satisfied()))
  WITH CHECK ((SELECT public.mfa_satisfied()));
