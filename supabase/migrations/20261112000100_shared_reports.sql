-- Read-only share links for reports (fixes 44 and 46).
--
-- A link is a random token handed to the person who creates it; only its
-- SHA-256 hash is stored, so the table never holds a usable link. The report
-- is frozen into `snapshot` when the link is made ("valued as of" that day),
-- computed on the server with the creator's own token, and always for one
-- client. Opening a link reads only that row (by hash, through the service
-- role on the server), so a link can never show another client's data.
--
-- Rows are written only by the server functions in shared-reports.functions.ts
-- (service role), after checking the caller is an agency admin or the
-- client's admin. Signed-in users may read the rows they're allowed to manage.

CREATE TABLE public.shared_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('loss_summary', 'executive_report')),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  snapshot jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '366 days')
);

CREATE INDEX shared_reports_client_idx ON public.shared_reports (client_id, created_at DESC);

ALTER TABLE public.shared_reports ENABLE ROW LEVEL SECURITY;

-- No INSERT / UPDATE / DELETE policies: only the service role writes.
CREATE POLICY "Agency admins and client admins see share links"
  ON public.shared_reports FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'agency_admin'::app_role)
    OR public.is_client_admin(client_id)
  );

REVOKE ALL ON public.shared_reports FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.shared_reports FROM authenticated;
GRANT SELECT ON public.shared_reports TO authenticated;
GRANT ALL ON public.shared_reports TO service_role;
