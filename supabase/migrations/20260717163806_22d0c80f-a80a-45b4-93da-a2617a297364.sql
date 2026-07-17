
-- Path convention: <tenant_id>/<run_id>/<file>.jpg
CREATE POLICY "qa_shots tenant read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'audit-qa-screenshots'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.tenant_has_module(public.current_tenant_id(), 'audit')
  );
