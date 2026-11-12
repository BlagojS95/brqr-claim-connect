-- Executive loss report (fix 46).
--
-- 1. Two claim fields the report needs and ClaimsQR didn't store: whether a
--    claim is in litigation, and for workers comp whether it is lost time or
--    medical only. Agency staff set them on the claim page.
-- 2. claim_reserve_history: every change to a claim's reserve, written by a
--    trigger, for the report's "largest reserve changes". History starts the
--    day this migration runs.
-- 3. report_schedules: "email me this report every month". Written only by
--    the server (service role) after checking who may schedule what.
-- 4. agency_settings.monthly_report_enabled: the master switch for those
--    emails, off by default like the weekly digest.

ALTER TABLE public.claims
  ADD COLUMN is_litigated boolean NOT NULL DEFAULT false,
  ADD COLUMN wc_claim_kind text CHECK (wc_claim_kind IN ('lost_time', 'medical_only'));

-- ── Reserve history ─────────────────────────────────────────────────────────

CREATE TABLE public.claim_reserve_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  old_reserve numeric,
  new_reserve numeric,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid
);

CREATE INDEX claim_reserve_history_claim_idx ON public.claim_reserve_history (claim_id, changed_at);
CREATE INDEX claim_reserve_history_time_idx ON public.claim_reserve_history (changed_at);

CREATE OR REPLACE FUNCTION public.log_reserve_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.claim_reserve_history (claim_id, old_reserve, new_reserve, changed_by)
  VALUES (NEW.id, OLD.reserve_amount, NEW.reserve_amount, auth.uid());
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_reserve_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER claims_log_reserve_change
  AFTER UPDATE OF reserve_amount ON public.claims
  FOR EACH ROW
  WHEN (OLD.reserve_amount IS DISTINCT FROM NEW.reserve_amount)
  EXECUTE FUNCTION public.log_reserve_change();

ALTER TABLE public.claim_reserve_history ENABLE ROW LEVEL SECURITY;

-- Read like the claim itself; only the trigger writes.
CREATE POLICY "agency reads reserve history" ON public.claim_reserve_history
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role));
CREATE POLICY "client reads reserve history of visible claims" ON public.claim_reserve_history
  FOR SELECT TO authenticated
  USING (public.can_see_claim(claim_id));

REVOKE ALL ON public.claim_reserve_history FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.claim_reserve_history FROM authenticated;
GRANT SELECT ON public.claim_reserve_history TO authenticated;
GRANT ALL ON public.claim_reserve_history TO service_role;

-- ── Monthly report schedules ────────────────────────────────────────────────

CREATE TABLE public.report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- The report goes to this login's email, nobody else.
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  large_loss_threshold numeric NOT NULL DEFAULT 25000 CHECK (large_loss_threshold >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- First day of the last month sent, so a re-run never sends twice.
  last_sent_month date,
  UNIQUE (client_id, user_id)
);

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own report schedules" ON public.report_schedules
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'agency_admin'::app_role));

REVOKE ALL ON public.report_schedules FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.report_schedules FROM authenticated;
GRANT SELECT ON public.report_schedules TO authenticated;
GRANT ALL ON public.report_schedules TO service_role;

-- ── Master switch ───────────────────────────────────────────────────────────

ALTER TABLE public.agency_settings
  ADD COLUMN monthly_report_enabled boolean NOT NULL DEFAULT false;
