
-- 1) Restrict storage SELECT on claim-documents to the owning client or admins
DROP POLICY IF EXISTS "auth read claim docs" ON storage.objects;
CREATE POLICY "owner or admin read claim docs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'claim-documents'
  AND (
    has_role(auth.uid(), 'agency_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.user_id = auth.uid()
        AND c.id::text = split_part(storage.objects.name, '/', 1)
    )
  )
);

-- 2) Restrict storage INSERT to the owning client or admins (path must start with their client_id)
DROP POLICY IF EXISTS "authenticated upload claim docs" ON storage.objects;
CREATE POLICY "owner or admin upload claim docs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'claim-documents'
  AND (
    has_role(auth.uid(), 'agency_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.user_id = auth.uid()
        AND c.id::text = split_part(name, '/', 1)
    )
  )
);

-- 3) Switch has_role to SECURITY INVOKER so authenticated users cannot use a
--    SECURITY DEFINER function to inspect other users' roles. The function
--    only reads user_roles, which already has RLS allowing each user to see
--    their own roles, so invoker mode is sufficient for current-user checks.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;
