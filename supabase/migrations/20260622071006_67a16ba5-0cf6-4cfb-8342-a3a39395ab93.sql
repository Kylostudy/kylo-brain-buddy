ALTER FUNCTION public.current_tenant_id() SECURITY INVOKER;
ALTER FUNCTION public.tenant_has_module(uuid, public.app_module) SECURITY INVOKER;