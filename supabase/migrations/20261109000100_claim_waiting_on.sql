-- Who has the ball on each claim, and when it last changed (fix 30).
--
-- claims.waiting_on: client, agency or carrier. Agency admins set it on /admin;
-- events set it too: a document request sets client, the last open request
-- being fulfilled sets agency (see 20261109000200_claim_document_requests.sql).
-- NULL on closed claims.
--
-- claims.last_activity_at: time of the newest claim_activity row, kept by a
-- trigger so the claims list can sort by "days since update" without a join.

CREATE TYPE public.claim_waiting_on AS ENUM ('client', 'agency', 'carrier');

ALTER TABLE public.claims
  ADD COLUMN waiting_on public.claim_waiting_on,
  ADD COLUMN last_activity_at timestamptz;

-- Backfill: the agency still has to report notices and submitted claims to the
-- carrier; open and reopened claims are with the carrier; closed ones aren't
-- waiting on anyone.
UPDATE public.claims SET waiting_on = CASE status
  WHEN 'notice' THEN 'agency'::public.claim_waiting_on
  WHEN 'submitted' THEN 'agency'::public.claim_waiting_on
  WHEN 'open' THEN 'carrier'::public.claim_waiting_on
  WHEN 'reopened' THEN 'carrier'::public.claim_waiting_on
  ELSE NULL
END;

UPDATE public.claims cl SET last_activity_at = coalesce(
  (SELECT max(a.created_at) FROM public.claim_activity a WHERE a.claim_id = cl.id),
  cl.created_at
);

-- New claims start with the agency (it has to send them to the carrier).
ALTER TABLE public.claims ALTER COLUMN waiting_on SET DEFAULT 'agency';
ALTER TABLE public.claims ALTER COLUMN last_activity_at SET DEFAULT now();

CREATE INDEX claims_last_activity_idx ON public.claims (client_id, last_activity_at);

CREATE OR REPLACE FUNCTION public.touch_claim_last_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.claims
     SET last_activity_at = greatest(coalesce(last_activity_at, NEW.created_at), NEW.created_at)
   WHERE id = NEW.claim_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER touch_claim_last_activity_trigger
AFTER INSERT ON public.claim_activity
FOR EACH ROW EXECUTE FUNCTION public.touch_claim_last_activity();

-- Closing a claim clears waiting_on; reopening hands it back to the carrier.
CREATE OR REPLACE FUNCTION public.claim_waiting_on_for_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.waiting_on IS NOT DISTINCT FROM OLD.waiting_on THEN
    IF NEW.status = 'closed' THEN
      NEW.waiting_on := NULL;
    ELSIF NEW.status = 'reopened' THEN
      NEW.waiting_on := 'carrier';
    ELSIF NEW.status = 'open' AND OLD.status IN ('notice', 'submitted') THEN
      NEW.waiting_on := 'carrier';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER claim_waiting_on_for_status_trigger
BEFORE UPDATE OF status ON public.claims
FOR EACH ROW EXECUTE FUNCTION public.claim_waiting_on_for_status();

REVOKE EXECUTE ON FUNCTION public.touch_claim_last_activity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_waiting_on_for_status() FROM PUBLIC, anon, authenticated;
