DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (
  auth.uid() = id
  AND tenant_id IS NOT DISTINCT FROM (
    SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
  )
);