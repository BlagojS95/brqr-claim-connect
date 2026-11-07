-- Outbox for the notifications sent when a client reports a claim (the agency
-- email and the n8n webhook). submitClaim writes one row per kind next to the
-- claim; a separate server step sends them, retrying up to 5 times, and leaves
-- the row 'sent' or 'failed' so a failed send is visible on /admin.
CREATE TABLE public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email', 'webhook')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (claim_id, kind)
);

CREATE INDEX notification_outbox_unsent_idx
  ON public.notification_outbox (status)
  WHERE status <> 'sent';

-- Only the server (service role, which bypasses RLS) writes this table.
-- Agency admins may read it; clients get nothing.
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads notification outbox" ON public.notification_outbox
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role));

REVOKE ALL ON public.notification_outbox FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.notification_outbox FROM authenticated;
