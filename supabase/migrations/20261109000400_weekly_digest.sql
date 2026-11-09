-- Weekly email digest (fix 33).
--
-- agency_settings.weekly_digest_enabled is the master switch, off by default:
-- the scheduled job sends nothing until an agency admin turns it on.
-- user_notification_prefs holds each user's opt-out (no row = subscribed).
-- digest_runs records each send so a retried cron call can't send twice in a week.

ALTER TABLE public.agency_settings
  ADD COLUMN weekly_digest_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE public.user_notification_prefs (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  weekly_digest boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own notification prefs" ON public.user_notification_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "admin reads notification prefs" ON public.user_notification_prefs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role));

REVOKE ALL ON public.user_notification_prefs FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.user_notification_prefs TO authenticated;
GRANT ALL ON public.user_notification_prefs TO service_role;

CREATE TABLE public.digest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);

ALTER TABLE public.digest_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads digest runs" ON public.digest_runs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role));

-- Only the server job (service role) writes runs.
REVOKE ALL ON public.digest_runs FROM anon, authenticated;
GRANT SELECT ON public.digest_runs TO authenticated;
GRANT ALL ON public.digest_runs TO service_role;
