-- Table controls (fix 50): each user's claims-list choices (visible columns,
-- density and last filters), so they are still there after signing out and
-- back in, on any device. One row per user; claims_list is parsed by the app
-- (src/lib/claims-table.ts), which falls back to defaults for anything it
-- doesn't recognise.

CREATE TABLE public.user_table_prefs (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  claims_list jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(claims_list) = 'object' AND pg_column_size(claims_list) <= 8192),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_table_prefs ENABLE ROW LEVEL SECURITY;

-- Own row only.
CREATE POLICY "users manage own table prefs" ON public.user_table_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- View as client (fix 55): no writes while an admin is viewing as a client,
-- the same restrictive policies the 20261116000500 migration put on every
-- table that existed then. (No read rule: this table has no client_id.)
CREATE POLICY "view as client: no insert" ON public.user_table_prefs
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.viewing_as_client(auth.uid())) IS NULL);
CREATE POLICY "view as client: no update" ON public.user_table_prefs
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT public.viewing_as_client(auth.uid())) IS NULL)
  WITH CHECK ((SELECT public.viewing_as_client(auth.uid())) IS NULL);
CREATE POLICY "view as client: no delete" ON public.user_table_prefs
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.viewing_as_client(auth.uid())) IS NULL);

REVOKE ALL ON public.user_table_prefs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_table_prefs TO authenticated;
GRANT ALL ON public.user_table_prefs TO service_role;
