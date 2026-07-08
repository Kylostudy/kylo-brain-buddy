
CREATE OR REPLACE FUNCTION public.prevent_profile_tenant_id_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    IF current_setting('role', true) <> 'service_role' AND (auth.jwt() ->> 'role') <> 'service_role' THEN
      RAISE EXCEPTION 'tenant_id cannot be changed by users';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_tenant_id_change ON public.profiles;
CREATE TRIGGER profiles_prevent_tenant_id_change
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_tenant_id_change();
