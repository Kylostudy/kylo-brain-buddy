REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.tenant_has_module(uuid, public.app_module) FROM authenticated, anon, public;