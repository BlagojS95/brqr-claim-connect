-- Fix 55: View as client (read only).
--
-- An agency admin can open a client's portal as that client sees it. The
-- session flag lives only here: one open row in admin_view_sessions per admin.
-- While it is open, for that admin's own token:
--   * reads of client data are limited to that client (RESTRICTIVE SELECT
--     policies below), so the portal shows exactly what the client's admin login
--     sees, even for pages that read Supabase straight from the browser;
--   * every INSERT, UPDATE and DELETE on every public table and on storage
--     objects is refused (RESTRICTIVE write policies below).
-- The server also refuses every server function that isn't on the read-only
-- list in src/lib/view-as.ts (the service role bypasses RLS, so the database
-- alone can't stop those). The rows are the log: who viewed which client, when
-- it started and when and how it ended.
--
-- Apply this AFTER every other migration of the phase: the write policies are
-- added to each public table that exists when it runs. scripts/rls-check.sql
-- fails for any table that is missing them.

CREATE TABLE public.admin_view_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_reason text CHECK (ended_reason IN ('exit', 'sign_out', 'replaced', 'expired')),
  CHECK ((ended_at IS NULL) = (ended_reason IS NULL))
);

-- At most one open session per admin; starting a new one ends the old first.
CREATE UNIQUE INDEX admin_view_sessions_one_open
  ON public.admin_view_sessions (admin_id) WHERE ended_at IS NULL;
CREATE INDEX admin_view_sessions_started_idx ON public.admin_view_sessions (started_at DESC);

ALTER TABLE public.admin_view_sessions ENABLE ROW LEVEL SECURITY;

-- Agency staff can read the log. Only the service role writes it (the start and
-- end server functions), so there are no write policies and no write grants.
CREATE POLICY "agency admins read view sessions" ON public.admin_view_sessions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role));
REVOKE ALL ON public.admin_view_sessions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.admin_view_sessions FROM authenticated;
GRANT SELECT ON public.admin_view_sessions TO authenticated;

-- The client an admin is viewing as right now, or null. A session counts for
-- 8 hours at most, so a forgotten one runs out on its own (the 8 hours are
-- also in src/lib/view-as.ts for the log card). Only for the caller's own id
-- (or for the service role / SQL editor, which have no auth.uid()), and only
-- while the user still is agency staff.
CREATE OR REPLACE FUNCTION public.viewing_as_client(_uid uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.client_id
    FROM public.admin_view_sessions s
   WHERE s.admin_id = _uid
     AND s.ended_at IS NULL
     AND s.started_at > now() - interval '8 hours'
     AND (auth.uid() IS NULL OR auth.uid() = _uid)
     AND public.has_role(_uid, 'agency_admin'::app_role)
   LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.viewing_as_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.viewing_as_client(uuid) TO authenticated, service_role;

-- RESTRICTIVE policies are ANDed with the existing permissive ones, so they can
-- only take access away, and only while the caller has an open session.
-- (SELECT ...) makes Postgres evaluate the function once per statement.
DO $views$
DECLARE
  t record;
  viewing constant text := '(SELECT public.viewing_as_client(auth.uid()))';
  read_rule text;
  no_rls text[] := '{}';
BEGIN
  FOR t IN
    SELECT c.relname, c.relrowsecurity,
           EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'client_id' AND NOT a.attisdropped) AS has_client,
           EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'claim_id' AND NOT a.attisdropped) AS has_claim
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relname <> 'admin_view_sessions'
     ORDER BY c.relname
  LOOP
    IF NOT t.relrowsecurity THEN
      no_rls := no_rls || t.relname::text;
    END IF;

    -- Writes: none at all while viewing.
    EXECUTE format('DROP POLICY IF EXISTS "view as client: no insert" ON public.%I', t.relname);
    EXECUTE format('DROP POLICY IF EXISTS "view as client: no update" ON public.%I', t.relname);
    EXECUTE format('DROP POLICY IF EXISTS "view as client: no delete" ON public.%I', t.relname);
    EXECUTE format(
      'CREATE POLICY "view as client: no insert" ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s IS NULL)',
      t.relname, viewing);
    EXECUTE format(
      'CREATE POLICY "view as client: no update" ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s IS NULL) WITH CHECK (%s IS NULL)',
      t.relname, viewing, viewing);
    EXECUTE format(
      'CREATE POLICY "view as client: no delete" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s IS NULL)',
      t.relname, viewing);

    -- Reads: only the viewed client's rows. Tables with neither column
    -- (lookups, agency_settings, user_roles, the admin's own prefs and saved
    -- views, digest_runs) are left as they are.
    read_rule := CASE
      WHEN t.relname = 'clients' THEN 'id = ' || viewing
      WHEN t.has_client THEN 'client_id = ' || viewing
      WHEN t.has_claim THEN format(
        'EXISTS (SELECT 1 FROM public.claims vc WHERE vc.id = %I.claim_id AND vc.client_id = %s)',
        t.relname, viewing)
      ELSE NULL
    END;
    EXECUTE format('DROP POLICY IF EXISTS "view as client: only that client" ON public.%I', t.relname);
    IF read_rule IS NOT NULL THEN
      EXECUTE format(
        'CREATE POLICY "view as client: only that client" ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (CASE WHEN %s IS NULL THEN true ELSE %s END)',
        t.relname, viewing, read_rule);
    END IF;
  END LOOP;

  IF cardinality(no_rls) > 0 THEN
    RAISE WARNING 'RLS is off on %; the view-as-client policies do nothing there until it is enabled',
      array_to_string(no_rls, ', ');
  END IF;
END
$views$;

-- Storage: no uploads, replacements or deletes while viewing, in any bucket;
-- claim files only from the viewed client's folder ("<client_id>/...").
DROP POLICY IF EXISTS "view as client: no insert" ON storage.objects;
DROP POLICY IF EXISTS "view as client: no update" ON storage.objects;
DROP POLICY IF EXISTS "view as client: no delete" ON storage.objects;
DROP POLICY IF EXISTS "view as client: only that client" ON storage.objects;
CREATE POLICY "view as client: no insert" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.viewing_as_client(auth.uid())) IS NULL);
CREATE POLICY "view as client: no update" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT public.viewing_as_client(auth.uid())) IS NULL)
  WITH CHECK ((SELECT public.viewing_as_client(auth.uid())) IS NULL);
CREATE POLICY "view as client: no delete" ON storage.objects
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.viewing_as_client(auth.uid())) IS NULL);
CREATE POLICY "view as client: only that client" ON storage.objects
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    CASE WHEN (SELECT public.viewing_as_client(auth.uid())) IS NULL OR bucket_id <> 'claim-documents'
      THEN true
      ELSE split_part(name, '/', 1) = (SELECT public.viewing_as_client(auth.uid()))::text
    END
  );
