-- Clients can remove documents they can see on their own claims. Admins
-- already can through "admin all docs" / "admin manage claim docs".

CREATE POLICY "client deletes own docs" ON public.documents FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = documents.client_id AND c.user_id = auth.uid()));

-- Only claim files (<client_id>/<claim_id>/...): the signature on file and
-- agency-uploaded loss runs live under the same client folder and must stay.
CREATE POLICY "client deletes own claim doc files" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'claim-documents'
    AND split_part(objects.name, '/', 2) NOT IN ('signature', 'loss-runs')
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.user_id = auth.uid()
        AND c.id::text = split_part(objects.name, '/', 1)
    )
  );
