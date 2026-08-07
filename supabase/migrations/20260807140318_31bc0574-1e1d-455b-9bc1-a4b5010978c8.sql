ALTER TABLE public.content_drafts
  ADD COLUMN IF NOT EXISTS media_path text,
  ADD COLUMN IF NOT EXISTS media_name text,
  ADD COLUMN IF NOT EXISTS media_mime text,
  ADD COLUMN IF NOT EXISTS media_size bigint,
  ADD COLUMN IF NOT EXISTS media_slot text;

CREATE POLICY "content_media_select_own_tenant"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'content-media'
  AND (storage.foldername(name))[1] = (
    SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
  )
);

CREATE POLICY "content_media_insert_own_tenant"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'content-media'
  AND (storage.foldername(name))[1] = (
    SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
  )
);

CREATE POLICY "content_media_update_own_tenant"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'content-media'
  AND (storage.foldername(name))[1] = (
    SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
  )
);

CREATE POLICY "content_media_delete_own_tenant"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'content-media'
  AND (storage.foldername(name))[1] = (
    SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
  )
);