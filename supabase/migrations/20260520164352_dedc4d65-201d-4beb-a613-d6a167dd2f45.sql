
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "public read claim docs" ON storage.objects;
CREATE POLICY "auth read claim docs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'claim-documents');
UPDATE storage.buckets SET public = false WHERE id = 'claim-documents';
