
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count int;
BEGIN
  INSERT INTO public.profiles (id, email, tenant_id, tenant_id_resolved_at)
  VALUES (NEW.id, NEW.email, NEW.id::text, now())
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    tenant_id = COALESCE(NULLIF(public.profiles.tenant_id, ''), EXCLUDED.tenant_id),
    tenant_id_resolved_at = COALESCE(public.profiles.tenant_id_resolved_at, EXCLUDED.tenant_id_resolved_at);

  -- If this is the very first user, claim any orphan workflows (dev tenant zero).
  SELECT count(*) INTO user_count FROM auth.users;
  IF user_count = 1 THEN
    UPDATE public.workflows
       SET tenant_id = NEW.id
     WHERE tenant_id = '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;

  RETURN NEW;
END;
$$;
