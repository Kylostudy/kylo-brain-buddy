GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_has_module(uuid, public.app_module) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.tenant_has_module(uuid, public.app_module) FROM anon;