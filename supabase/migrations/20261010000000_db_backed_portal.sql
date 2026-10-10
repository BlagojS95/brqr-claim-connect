-- Portal data (clients, policies, claims) now lives in these tables and is
-- loaded by CSV import, instead of being read live from AMS360 on every page.

-- Logins are created by an agency admin for a clients row that already exists,
-- so a new auth user must no longer get a blank clients row of its own.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'client') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- As SECURITY INVOKER, has_role() reads user_roles under RLS, and the
-- user_roles policies call has_role() themselves, so the check recurses.
-- Run it as definer again, but only ever answer for the calling user so it
-- still can't be used to inspect anyone else's roles.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Guards so re-importing the same CSV can't create duplicates.
-- clients.ams360_id is reused as the client number from the CSV.
CREATE UNIQUE INDEX IF NOT EXISTS clients_ams360_id_key
  ON public.clients (ams360_id)
  WHERE ams360_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS policies_client_policy_effective_key
  ON public.policies (client_id, policy_number, effective_date);

CREATE UNIQUE INDEX IF NOT EXISTS claims_client_claim_number_key
  ON public.claims (client_id, claim_number)
  WHERE claim_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS claims_client_id_idx ON public.claims (client_id);

-- Password resets and account deletion now go through the Supabase admin API
-- with the service-role key (see src/lib/accounts.functions.ts), so the
-- functions that edited auth.users directly are no longer needed.
DROP FUNCTION IF EXISTS public.admin_set_user_password(uuid, text);
DROP FUNCTION IF EXISTS public.admin_delete_client_account(uuid);
