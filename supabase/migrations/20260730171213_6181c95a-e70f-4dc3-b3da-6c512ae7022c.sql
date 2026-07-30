CREATE OR REPLACE FUNCTION public.is_platform_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_module_access tma
    WHERE tma.tenant_id = public.current_tenant_id()
      AND tma.revoked_at IS NULL
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_platform_operator() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_platform_operator() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_platform_operator() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_operator() TO service_role;