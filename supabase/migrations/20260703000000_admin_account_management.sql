-- Lets an agency_admin reset a client's password or fully delete their login,
-- without needing the service_role key (Lovable Cloud doesn't expose it).
-- SECURITY DEFINER runs with elevated privileges, so each function re-checks
-- the caller's admin role itself before touching anything.

CREATE OR REPLACE FUNCTION public.admin_set_user_password(target_user_id uuid, new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'agency_admin') THEN
    RAISE EXCEPTION 'Unauthorized: agency_admin role required';
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf')),
      updated_at = now()
  WHERE id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_password(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_client_account(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'agency_admin') THEN
    RAISE EXCEPTION 'Unauthorized: agency_admin role required';
  END IF;

  DELETE FROM public.clients WHERE user_id = target_user_id;
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_client_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_client_account(uuid) TO authenticated;
