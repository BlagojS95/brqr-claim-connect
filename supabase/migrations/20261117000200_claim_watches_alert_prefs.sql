-- Watch and alert preferences (fix 48).
--
-- claim_watches: a user "watches" a claim to get email alerts about it. Each
-- user manages only their own rows, and only for claims they can see
-- (public.can_see_claim, fix 32: agency staff every claim, company logins
-- their client's claims, location users only their locations').
--
-- user_notification_prefs (fix 33) gains one pair of switches per kind of
-- alert: for claims the user watches, and for every claim they can see.
-- Defaults: watched claims on, all claims off. No row means the defaults.

CREATE TABLE public.claim_watches (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, claim_id)
);

CREATE INDEX claim_watches_claim_idx ON public.claim_watches (claim_id);

ALTER TABLE public.claim_watches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own watches: read" ON public.claim_watches
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "own watches: add on visible claims" ON public.claim_watches
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND (
    public.has_role(auth.uid(), 'agency_admin'::app_role) OR public.can_see_claim(claim_id)
  ));
CREATE POLICY "own watches: remove" ON public.claim_watches
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.claim_watches FROM anon, authenticated;
GRANT SELECT, DELETE ON public.claim_watches TO authenticated;
GRANT INSERT (user_id, claim_id) ON public.claim_watches TO authenticated;
GRANT ALL ON public.claim_watches TO service_role;

-- View as client (fix 55): same restrictive policies every table carries.
CREATE POLICY "view as client: no insert" ON public.claim_watches
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.viewing_as_client(auth.uid())) IS NULL);
CREATE POLICY "view as client: no update" ON public.claim_watches
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT public.viewing_as_client(auth.uid())) IS NULL)
  WITH CHECK ((SELECT public.viewing_as_client(auth.uid())) IS NULL);
CREATE POLICY "view as client: no delete" ON public.claim_watches
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.viewing_as_client(auth.uid())) IS NULL);
CREATE POLICY "view as client: only that client" ON public.claim_watches
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    CASE WHEN (SELECT public.viewing_as_client(auth.uid())) IS NULL THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.claims vc
       WHERE vc.id = claim_watches.claim_id
         AND vc.client_id = (SELECT public.viewing_as_client(auth.uid()))
    ) END
  );

ALTER TABLE public.user_notification_prefs
  ADD COLUMN status_watched boolean NOT NULL DEFAULT true,
  ADD COLUMN status_all boolean NOT NULL DEFAULT false,
  ADD COLUMN messages_watched boolean NOT NULL DEFAULT true,
  ADD COLUMN messages_all boolean NOT NULL DEFAULT false,
  ADD COLUMN documents_watched boolean NOT NULL DEFAULT true,
  ADD COLUMN documents_all boolean NOT NULL DEFAULT false;
