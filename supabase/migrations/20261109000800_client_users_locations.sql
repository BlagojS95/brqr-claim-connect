-- Locations and several users per client (fix 32).
--
-- client_locations: a client's sites. claims.location_id and policies.location_id
-- point at them (NULL = not tied to a site).
-- client_users: every client login and what it may see:
--   client_admin  whole company, and manages the company's users and locations
--   company       whole company
--   location      only claims at its location_ids (and their documents,
--                 activity, contacts and requests), policies for those sites or
--                 company-wide ones; no loss runs
-- clients.user_id stays as the company's first login (the agency creates it on
-- /admin); a trigger keeps it in client_users as a client_admin.
--
-- Every client policy now goes through the helper functions below instead of
-- "clients.user_id = auth.uid()". Agency admin policies are unchanged.
-- client_users is written only by server code (service role) after it checks
-- the caller is that client's client_admin, so nobody can grant themselves access.

CREATE TYPE public.client_user_role AS ENUM ('client_admin', 'company', 'location');

CREATE TABLE public.client_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  address text CHECK (address IS NULL OR char_length(address) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, name),
  UNIQUE (client_id, id)
);

CREATE TABLE public.client_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  role public.client_user_role NOT NULL DEFAULT 'company',
  location_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role <> 'location' OR cardinality(location_ids) > 0)
);

CREATE INDEX client_users_client_idx ON public.client_users (client_id);

ALTER TABLE public.claims
  ADD COLUMN location_id uuid REFERENCES public.client_locations(id) ON DELETE SET NULL;
ALTER TABLE public.policies
  ADD COLUMN location_id uuid REFERENCES public.client_locations(id) ON DELETE SET NULL;
CREATE INDEX claims_location_idx ON public.claims (location_id);
CREATE INDEX policies_location_idx ON public.policies (location_id);

-- A claim or policy can only point at one of its own client's locations.
-- SECURITY DEFINER: this checks ownership, not what the caller can see
-- (RLS on the insert decides that).
CREATE OR REPLACE FUNCTION public.check_location_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.client_locations l
     WHERE l.id = NEW.location_id AND l.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'Location does not belong to this client' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER claims_location_client_check
BEFORE INSERT OR UPDATE OF location_id, client_id ON public.claims
FOR EACH ROW EXECUTE FUNCTION public.check_location_client();
CREATE TRIGGER policies_location_client_check
BEFORE INSERT OR UPDATE OF location_id, client_id ON public.policies
FOR EACH ROW EXECUTE FUNCTION public.check_location_client();

-- A location user's locations must belong to their client.
CREATE OR REPLACE FUNCTION public.check_client_user_locations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.location_ids) AS lid
     WHERE NOT EXISTS (
       SELECT 1 FROM public.client_locations l WHERE l.id = lid AND l.client_id = NEW.client_id
     )
  ) THEN
    RAISE EXCEPTION 'Location does not belong to this client' USING ERRCODE = '23503';
  END IF;
  IF NEW.role <> 'location' THEN
    NEW.location_ids := '{}';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER client_users_locations_check
BEFORE INSERT OR UPDATE ON public.client_users
FOR EACH ROW EXECUTE FUNCTION public.check_client_user_locations();

-- Backfill: every existing client login becomes that client's admin.
INSERT INTO public.client_users (user_id, client_id, role)
SELECT user_id, id, 'client_admin' FROM public.clients WHERE user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- Keep the agency-created first login (clients.user_id) in client_users.
CREATE OR REPLACE FUNCTION public.sync_client_primary_login()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    INSERT INTO public.client_users (user_id, client_id, role)
    VALUES (NEW.user_id, NEW.id, 'client_admin')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_client_primary_login_insert
AFTER INSERT ON public.clients
FOR EACH ROW WHEN (NEW.user_id IS NOT NULL)
EXECUTE FUNCTION public.sync_client_primary_login();
CREATE TRIGGER sync_client_primary_login_update
AFTER UPDATE OF user_id ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.sync_client_primary_login();

-- Access helpers. SECURITY DEFINER so policies can read client_users and claims
-- without recursing through their own RLS; each only answers for auth.uid().

CREATE OR REPLACE FUNCTION public.is_client_member(_client_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_users
     WHERE user_id = auth.uid() AND client_id = _client_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_client_wide(_client_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_users
     WHERE user_id = auth.uid() AND client_id = _client_id
       AND role IN ('client_admin', 'company')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_client_admin(_client_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_users
     WHERE user_id = auth.uid() AND client_id = _client_id AND role = 'client_admin'
  )
$$;

-- Company-wide users see every location (and rows with no location);
-- location users only rows at one of their locations.
CREATE OR REPLACE FUNCTION public.can_see_location(_client_id uuid, _location_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_users
     WHERE user_id = auth.uid() AND client_id = _client_id
       AND (role IN ('client_admin', 'company')
            OR (_location_id IS NOT NULL AND _location_id = ANY (location_ids)))
  )
$$;

CREATE OR REPLACE FUNCTION public.can_see_claim(_claim_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.claims cl
     WHERE cl.id = _claim_id AND public.can_see_location(cl.client_id, cl.location_id)
  )
$$;

-- Storage paths are "<client_id>/<claim_id or 'loss-runs' or 'signature'>/<file>".
-- read:   company-wide users see the whole folder; location users only files
--         under claims they can see, plus the signature folder.
-- upload: also allowed into a claim folder whose claim doesn't exist yet,
--         because the report form uploads files before submitClaim creates it.
CREATE OR REPLACE FUNCTION public.can_access_claim_file(_name text, _for_upload boolean)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _client uuid;
  _claim uuid;
  _seg2 text := split_part(_name, '/', 2);
BEGIN
  BEGIN
    _client := split_part(_name, '/', 1)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;

  IF NOT public.is_client_member(_client) THEN
    RETURN false;
  END IF;
  IF public.is_client_wide(_client) THEN
    RETURN true;
  END IF;
  -- Every member may read and add the company's signature on file.
  IF _seg2 = 'signature' THEN
    RETURN true;
  END IF;

  BEGIN
    _claim := _seg2::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;

  IF public.can_see_claim(_claim) THEN
    RETURN true;
  END IF;
  RETURN _for_upload AND NOT EXISTS (SELECT 1 FROM public.claims WHERE id = _claim);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_location_client() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_client_user_locations() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_client_primary_login() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_client_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_client_wide(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_client_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_see_location(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_see_claim(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_claim_file(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_client_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_client_wide(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_client_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_location(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_claim_file(text, boolean) TO authenticated;

-- New tables.
ALTER TABLE public.client_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all client locations" ON public.client_locations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'agency_admin'::app_role));
CREATE POLICY "client sees own locations" ON public.client_locations
  FOR SELECT TO authenticated
  USING (public.can_see_location(client_id, id));
CREATE POLICY "client admin manages locations" ON public.client_locations
  FOR ALL TO authenticated
  USING (public.is_client_admin(client_id))
  WITH CHECK (public.is_client_admin(client_id));

CREATE POLICY "admin reads client users" ON public.client_users
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'agency_admin'::app_role));
CREATE POLICY "user reads own membership" ON public.client_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "client admin reads company users" ON public.client_users
  FOR SELECT TO authenticated
  USING (public.is_client_admin(client_id));

REVOKE ALL ON public.client_locations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_locations TO authenticated;
GRANT ALL ON public.client_locations TO service_role;
REVOKE ALL ON public.client_users FROM anon, authenticated;
GRANT SELECT ON public.client_users TO authenticated;
GRANT ALL ON public.client_users TO service_role;

-- Rewrite every client policy onto the helpers.

-- clients
DROP POLICY "client sees self" ON public.clients;
CREATE POLICY "client sees self" ON public.clients
  FOR SELECT TO authenticated USING (public.is_client_member(id));

-- claims
DROP POLICY "client sees own claims" ON public.claims;
DROP POLICY "client creates own claims" ON public.claims;
CREATE POLICY "client sees own claims" ON public.claims
  FOR SELECT TO authenticated USING (public.can_see_location(client_id, location_id));
CREATE POLICY "client creates own claims" ON public.claims
  FOR INSERT TO authenticated WITH CHECK (public.can_see_location(client_id, location_id));

-- policies: company-wide policies (no location) are visible to every member.
DROP POLICY "client sees own policies" ON public.policies;
CREATE POLICY "client sees own policies" ON public.policies
  FOR SELECT TO authenticated
  USING (
    public.is_client_member(client_id)
    AND (location_id IS NULL OR public.can_see_location(client_id, location_id))
  );

-- documents: claim documents follow the claim; client-level ones are company-wide.
DROP POLICY "client sees own docs" ON public.documents;
DROP POLICY "client uploads own docs" ON public.documents;
DROP POLICY "client deletes own docs" ON public.documents;
CREATE POLICY "client sees own docs" ON public.documents
  FOR SELECT TO authenticated
  USING (
    public.is_client_member(client_id)
    AND (CASE WHEN claim_id IS NULL THEN public.is_client_wide(client_id)
              ELSE public.can_see_claim(claim_id) END)
  );
CREATE POLICY "client uploads own docs" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_client_member(client_id)
    AND (CASE WHEN claim_id IS NULL THEN public.is_client_wide(client_id)
              ELSE EXISTS (SELECT 1 FROM public.claims cl
                            WHERE cl.id = documents.claim_id AND cl.client_id = documents.client_id)
                   AND public.can_see_claim(claim_id) END)
  );
CREATE POLICY "client deletes own docs" ON public.documents
  FOR DELETE TO authenticated
  USING (
    public.is_client_member(client_id)
    AND (CASE WHEN claim_id IS NULL THEN public.is_client_wide(client_id)
              ELSE public.can_see_claim(claim_id) END)
  );

-- claim_activity
DROP POLICY "client reads own claim activity" ON public.claim_activity;
DROP POLICY "client adds notes on own claims" ON public.claim_activity;
CREATE POLICY "client reads own claim activity" ON public.claim_activity
  FOR SELECT TO authenticated USING (public.can_see_claim(claim_id));
CREATE POLICY "client adds notes on own claims" ON public.claim_activity
  FOR INSERT TO authenticated
  WITH CHECK (kind = 'note' AND actor_id = auth.uid() AND public.can_see_claim(claim_id));

-- claim_document_requests
DROP POLICY "client reads own document requests" ON public.claim_document_requests;
CREATE POLICY "client reads own document requests" ON public.claim_document_requests
  FOR SELECT TO authenticated USING (public.can_see_claim(claim_id));

-- claim_contacts
DROP POLICY "client manages own claim contacts" ON public.claim_contacts;
DROP POLICY "client updates own claim contacts" ON public.claim_contacts;
CREATE POLICY "client manages own claim contacts" ON public.claim_contacts
  FOR SELECT TO authenticated
  USING (public.is_client_member(client_id) AND public.can_see_claim(claim_id));
CREATE POLICY "client updates own claim contacts" ON public.claim_contacts
  FOR UPDATE TO authenticated
  USING (public.is_client_member(client_id) AND public.can_see_claim(claim_id))
  WITH CHECK (public.is_client_member(client_id) AND public.can_see_claim(claim_id));

-- claim_contact_emails
DROP POLICY "client sees own claim contact emails" ON public.claim_contact_emails;
DROP POLICY "client inserts own claim contact emails" ON public.claim_contact_emails;
DROP POLICY "client updates own claim contact emails" ON public.claim_contact_emails;
CREATE POLICY "client sees own claim contact emails" ON public.claim_contact_emails
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.claim_contacts cc
     WHERE cc.id = claim_contact_emails.claim_contact_id
       AND public.is_client_member(cc.client_id) AND public.can_see_claim(cc.claim_id)
  ));
CREATE POLICY "client inserts own claim contact emails" ON public.claim_contact_emails
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.claim_contacts cc
     WHERE cc.id = claim_contact_emails.claim_contact_id
       AND public.is_client_member(cc.client_id) AND public.can_see_claim(cc.claim_id)
  ));
CREATE POLICY "client updates own claim contact emails" ON public.claim_contact_emails
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.claim_contacts cc
     WHERE cc.id = claim_contact_emails.claim_contact_id
       AND public.is_client_member(cc.client_id) AND public.can_see_claim(cc.claim_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.claim_contacts cc
     WHERE cc.id = claim_contact_emails.claim_contact_id
       AND public.is_client_member(cc.client_id) AND public.can_see_claim(cc.claim_id)
  ));

-- client_signatures: any member can read the company's signature on file and sign.
DROP POLICY "client reads own signatures" ON public.client_signatures;
DROP POLICY "client signs for themselves" ON public.client_signatures;
CREATE POLICY "client reads own signatures" ON public.client_signatures
  FOR SELECT TO authenticated USING (public.is_client_member(client_id));
CREATE POLICY "client signs for themselves" ON public.client_signatures
  FOR INSERT TO authenticated
  WITH CHECK (signed_by = auth.uid() AND revoked_at IS NULL AND public.is_client_member(client_id));

-- loss runs and loss run requests: company-wide users only.
DROP POLICY "client sees own loss runs" ON public.loss_runs;
CREATE POLICY "client sees own loss runs" ON public.loss_runs
  FOR SELECT TO authenticated USING (public.is_client_wide(client_id));
DROP POLICY "client sees own loss run requests" ON public.loss_run_requests;
DROP POLICY "client creates own loss run requests" ON public.loss_run_requests;
CREATE POLICY "client sees own loss run requests" ON public.loss_run_requests
  FOR SELECT TO authenticated USING (public.is_client_wide(client_id));
CREATE POLICY "client creates own loss run requests" ON public.loss_run_requests
  FOR INSERT TO authenticated WITH CHECK (public.is_client_wide(client_id));

-- storage
DROP POLICY "owner or admin read claim docs" ON storage.objects;
DROP POLICY "owner or admin upload claim docs" ON storage.objects;
DROP POLICY "client deletes own claim doc files" ON storage.objects;
CREATE POLICY "owner or admin read claim docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'claim-documents'
    AND (public.has_role(auth.uid(), 'agency_admin'::app_role)
         OR public.can_access_claim_file(name, false))
  );
CREATE POLICY "owner or admin upload claim docs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'claim-documents'
    AND (public.has_role(auth.uid(), 'agency_admin'::app_role)
         OR public.can_access_claim_file(name, true))
  );
CREATE POLICY "client deletes own claim doc files" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'claim-documents'
    AND split_part(name, '/', 2) <> ALL (ARRAY['signature', 'loss-runs'])
    AND public.can_access_claim_file(name, false)
  );
