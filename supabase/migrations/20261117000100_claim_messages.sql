-- Claim messages (fix 47): a conversation thread per claim between the client
-- and the agency, shown on the claim page under "Messages".
--
-- claim_messages: one row per message. mentions holds the user ids that were
-- @mentioned (worked out by the server from the text, against the people who
-- may see the claim). Messages are never edited or deleted, so there are no
-- UPDATE or DELETE policies or grants.
--
-- Who may read and post:
--   agency_admin  every claim
--   client users  claims they can see: company-wide logins every claim of
--                 their client, location users only claims at their locations
--                 (public.can_see_claim from fix 32, as on claim_activity)
-- Everyone posts only as themselves (author_id = auth.uid()); created_at is
-- not writable, so a message can't be back-dated.
--
-- Each new message also adds a claim_activity entry, kind 'message'
-- ("Message: <first 200 characters>"), from the trigger below.

CREATE TABLE public.claim_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000 AND char_length(body) <= 4000),
  mentions uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(mentions) <= 50),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX claim_messages_claim_created_idx ON public.claim_messages (claim_id, created_at);

ALTER TABLE public.claim_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads claim messages" ON public.claim_messages
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role));
CREATE POLICY "admin posts claim messages" ON public.claim_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'agency_admin'::app_role)
    AND author_id = auth.uid()
  );

CREATE POLICY "client reads own claim messages" ON public.claim_messages
  FOR SELECT TO authenticated
  USING (public.can_see_claim(claim_id));
CREATE POLICY "client posts on own claims" ON public.claim_messages
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.can_see_claim(claim_id));

REVOKE ALL ON public.claim_messages FROM anon, authenticated;
GRANT SELECT ON public.claim_messages TO authenticated;
GRANT INSERT (claim_id, author_id, body, mentions) ON public.claim_messages TO authenticated;
GRANT ALL ON public.claim_messages TO service_role;

-- View as client (fix 55): no writes while an admin views as a client, and
-- only the viewed client's messages. Same policies the fix 55 migration added
-- to every table that existed then.
CREATE POLICY "view as client: no insert" ON public.claim_messages
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.viewing_as_client(auth.uid())) IS NULL);
CREATE POLICY "view as client: no update" ON public.claim_messages
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT public.viewing_as_client(auth.uid())) IS NULL)
  WITH CHECK ((SELECT public.viewing_as_client(auth.uid())) IS NULL);
CREATE POLICY "view as client: no delete" ON public.claim_messages
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.viewing_as_client(auth.uid())) IS NULL);
CREATE POLICY "view as client: only that client" ON public.claim_messages
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    CASE WHEN (SELECT public.viewing_as_client(auth.uid())) IS NULL THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.claims vc
       WHERE vc.id = claim_messages.claim_id
         AND vc.client_id = (SELECT public.viewing_as_client(auth.uid()))
    ) END
  );

-- The activity log gains the 'message' kind (every earlier kind kept).
ALTER TABLE public.claim_activity DROP CONSTRAINT claim_activity_kind_check;
ALTER TABLE public.claim_activity ADD CONSTRAINT claim_activity_kind_check
  CHECK (kind IN ('created', 'status_change', 'document', 'email', 'follow_up', 'note',
                  'claim_update', 'message'));

-- One activity entry per message. SECURITY DEFINER because clients may only
-- add notes to claim_activity themselves; the insert into claim_messages has
-- already passed RLS.
CREATE OR REPLACE FUNCTION public.log_claim_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.claim_activity (claim_id, actor_id, kind, body)
  VALUES (NEW.claim_id, NEW.author_id, 'message', 'Message: ' || left(btrim(NEW.body), 200));
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_claim_message() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER claim_messages_log_activity
AFTER INSERT ON public.claim_messages
FOR EACH ROW EXECUTE FUNCTION public.log_claim_message();
