-- Activity log per claim (fix 12), shown newest first on the claim detail page.
-- Kinds and their labels live in src/lib/claim-activity.ts.
--
-- Written by:
--   created       trigger on claims INSERT ("Claim reported" / "Incident notice reported")
--   status_change trigger on claims UPDATE OF status, only when it changes
--   document      trigger on documents INSERT for a claim (file name)
--   email         server code (service role) when a notification_outbox row ends sent/failed,
--                 and the trigger on claim_contact_emails for the first email to a contact
--   follow_up     trigger on claim_contact_emails: a later email to the same contact
--                 ("Send Follow Up"), or the contact being marked as replied
--   note          "Add note" on the claim page (server function, caller's token)
--
-- actor_id is auth.uid() of whoever made the change; NULL means the system
-- (service role, CSV import run without a user, or the backfill below).
-- The triggers are SECURITY DEFINER so they can write here whatever the
-- caller's RLS allows; nobody but an agency_admin can write anything but a
-- note directly.

CREATE TABLE public.claim_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('created', 'status_change', 'document', 'email', 'follow_up', 'note')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX claim_activity_claim_created_idx
  ON public.claim_activity (claim_id, created_at DESC);

ALTER TABLE public.claim_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads claim activity" ON public.claim_activity
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role));

CREATE POLICY "admin adds claim activity" ON public.claim_activity
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'agency_admin'::app_role)
    AND (actor_id IS NULL OR actor_id = auth.uid())
  );

CREATE POLICY "client reads own claim activity" ON public.claim_activity
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.claims cl
    JOIN public.clients c ON c.id = cl.client_id
    WHERE cl.id = claim_activity.claim_id AND c.user_id = auth.uid()
  ));

CREATE POLICY "client adds notes on own claims" ON public.claim_activity
  FOR INSERT TO authenticated
  WITH CHECK (
    kind = 'note'
    AND actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.claims cl
      JOIN public.clients c ON c.id = cl.client_id
      WHERE cl.id = claim_activity.claim_id AND c.user_id = auth.uid()
    )
  );

-- The log is append-only for everyone using the API; no UPDATE/DELETE policies.
REVOKE ALL ON public.claim_activity FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.claim_activity FROM authenticated;
GRANT SELECT, INSERT ON public.claim_activity TO authenticated;
GRANT ALL ON public.claim_activity TO service_role;

-- Claim created.
CREATE OR REPLACE FUNCTION public.log_claim_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.claim_activity (claim_id, actor_id, kind, body)
  VALUES (
    NEW.id,
    coalesce(auth.uid(), NEW.created_by),
    'created',
    CASE
      WHEN NEW.created_by IS NULL AND NEW.is_notice_only THEN 'Incident notice added'
      WHEN NEW.created_by IS NULL THEN 'Claim added'
      WHEN NEW.is_notice_only THEN 'Incident notice reported'
      ELSE 'Claim reported'
    END
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER log_claim_created_trigger
AFTER INSERT ON public.claims
FOR EACH ROW EXECUTE FUNCTION public.log_claim_created();

-- Status changed.
CREATE OR REPLACE FUNCTION public.log_claim_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.claim_activity (claim_id, actor_id, kind, body)
    VALUES (
      NEW.id,
      auth.uid(),
      'status_change',
      format('Status changed from %s to %s', initcap(OLD.status::text), initcap(NEW.status::text))
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER log_claim_status_change_trigger
AFTER UPDATE OF status ON public.claims
FOR EACH ROW EXECUTE FUNCTION public.log_claim_status_change();

-- Document uploaded to a claim.
CREATE OR REPLACE FUNCTION public.log_claim_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.claim_id IS NOT NULL THEN
    INSERT INTO public.claim_activity (claim_id, actor_id, kind, body)
    VALUES (NEW.claim_id, auth.uid(), 'document', left('Document uploaded: ' || NEW.file_name, 4000));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER log_claim_document_trigger
AFTER INSERT ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.log_claim_document();

-- Emails logged from the claim contacts table. The first email to a contact is
-- an 'email'; "Send Follow Up" (only offered once an email exists) logs a
-- 'follow_up'. claim_contact_emails.claim_id has no FK to claims, so skip ids
-- that aren't a claim rather than failing the insert.
CREATE OR REPLACE FUNCTION public.contact_row_label(_row_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _row_key
    WHEN 'broker_claims_contact' THEN 'Broker Claims Contact'
    WHEN 'adjuster' THEN 'Adjuster'
    WHEN 'attorney' THEN 'Attorney'
    ELSE 'Other contact'
  END
$$;

CREATE OR REPLACE FUNCTION public.log_claim_contact_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _contact public.claim_contacts%ROWTYPE;
  _who text;
  _earlier boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.claims WHERE id = NEW.claim_id) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _contact FROM public.claim_contacts WHERE id = NEW.claim_contact_id;
  _who := public.contact_row_label(_contact.row_key);
  IF nullif(btrim(_contact.email), '') IS NOT NULL THEN
    _who := _who || ' (' || btrim(_contact.email) || ')';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.claim_contact_emails e
      WHERE e.claim_contact_id = NEW.claim_contact_id AND e.id <> NEW.id
    ) INTO _earlier;

    INSERT INTO public.claim_activity (claim_id, actor_id, kind, body)
    VALUES (
      NEW.claim_id,
      coalesce(auth.uid(), NEW.sent_by),
      CASE WHEN _earlier THEN 'follow_up' ELSE 'email' END,
      left(CASE WHEN _earlier THEN 'Follow-up email sent to ' ELSE 'Email sent to ' END || _who, 4000)
    );
  ELSIF NEW.replied_at IS NOT NULL AND OLD.replied_at IS NULL THEN
    INSERT INTO public.claim_activity (claim_id, actor_id, kind, body)
    VALUES (NEW.claim_id, auth.uid(), 'follow_up', left(_who || ' replied', 4000));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER log_claim_contact_email_trigger
AFTER INSERT OR UPDATE OF replied_at ON public.claim_contact_emails
FOR EACH ROW EXECUTE FUNCTION public.log_claim_contact_email();

-- Trigger functions aren't meant to be called through the API.
REVOKE EXECUTE ON FUNCTION public.log_claim_created() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_claim_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_claim_document() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_claim_contact_email() FROM PUBLIC, anon, authenticated;

-- Backfill: one entry per existing claim, dated when the claim was created,
-- so older claims don't start with an empty log.
INSERT INTO public.claim_activity (claim_id, actor_id, kind, body, created_at)
SELECT
  cl.id,
  cl.created_by,
  'created',
  CASE
    WHEN cl.created_by IS NULL AND cl.is_notice_only THEN 'Incident notice added'
    WHEN cl.created_by IS NULL THEN 'Claim added'
    WHEN cl.is_notice_only THEN 'Incident notice reported'
    ELSE 'Claim reported'
  END,
  cl.created_at
FROM public.claims cl;
