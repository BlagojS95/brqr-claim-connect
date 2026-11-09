-- Document requests on a claim (fix 37).
--
-- An agency admin asks for named documents; the client sees them as
-- "Requested from you" on the claim and uploads against each one. The upload
-- (a documents row with document_request_id set) closes the request through
-- the trigger below, which also logs activity and moves waiting_on:
--   request created           -> waiting_on = client
--   last open request closed  -> waiting_on = agency
-- Clients never write this table directly.

CREATE TABLE public.claim_document_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  note text CHECK (note IS NULL OR char_length(note) <= 2000),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  fulfilled_at timestamptz
);

CREATE INDEX claim_document_requests_claim_idx
  ON public.claim_document_requests (claim_id, requested_at);
CREATE INDEX claim_document_requests_open_idx
  ON public.claim_document_requests (claim_id) WHERE fulfilled_at IS NULL;

ALTER TABLE public.claim_document_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all document requests" ON public.claim_document_requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'agency_admin'::app_role));

CREATE POLICY "client reads own document requests" ON public.claim_document_requests
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.claims cl
    JOIN public.clients c ON c.id = cl.client_id
    WHERE cl.id = claim_document_requests.claim_id AND c.user_id = auth.uid()
  ));

REVOKE ALL ON public.claim_document_requests FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.claim_document_requests TO authenticated;
GRANT ALL ON public.claim_document_requests TO service_role;

-- The upload that answers a request.
ALTER TABLE public.documents
  ADD COLUMN document_request_id uuid REFERENCES public.claim_document_requests(id) ON DELETE SET NULL;

-- Request created: log it and put the ball with the client.
CREATE OR REPLACE FUNCTION public.on_document_request_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.claim_activity (claim_id, actor_id, kind, body)
  VALUES (NEW.claim_id, coalesce(auth.uid(), NEW.requested_by), 'document',
          left('Document requested: ' || btrim(NEW.name), 4000));
  UPDATE public.claims SET waiting_on = 'client'
   WHERE id = NEW.claim_id AND status <> 'closed';
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_document_request_created_trigger
AFTER INSERT ON public.claim_document_requests
FOR EACH ROW EXECUTE FUNCTION public.on_document_request_created();

-- Upload against a request: close it if it belongs to the same claim and
-- client and is still open; when none are left open, back to the agency.
CREATE OR REPLACE FUNCTION public.fulfill_document_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req public.claim_document_requests%ROWTYPE;
BEGIN
  IF NEW.document_request_id IS NULL OR NEW.claim_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT r.* INTO _req
    FROM public.claim_document_requests r
    JOIN public.claims cl ON cl.id = r.claim_id
   WHERE r.id = NEW.document_request_id
     AND r.claim_id = NEW.claim_id
     AND cl.client_id = NEW.client_id
     AND r.fulfilled_at IS NULL
   FOR UPDATE OF r;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE public.claim_document_requests
     SET fulfilled_document_id = NEW.id, fulfilled_at = now()
   WHERE id = _req.id;

  INSERT INTO public.claim_activity (claim_id, actor_id, kind, body)
  VALUES (NEW.claim_id, auth.uid(), 'document',
          left('Requested document received: ' || btrim(_req.name), 4000));

  IF NOT EXISTS (
    SELECT 1 FROM public.claim_document_requests
     WHERE claim_id = NEW.claim_id AND fulfilled_at IS NULL
  ) THEN
    UPDATE public.claims SET waiting_on = 'agency'
     WHERE id = NEW.claim_id AND waiting_on = 'client';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fulfill_document_request_trigger
AFTER INSERT ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.fulfill_document_request();

REVOKE EXECUTE ON FUNCTION public.on_document_request_created() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fulfill_document_request() FROM PUBLIC, anon, authenticated;
