CREATE POLICY "ui_recon_shots_read_own_tenant"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'ui-recon-shots'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );