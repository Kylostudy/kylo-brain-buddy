
-- Biztonsági linter javítás: csak a szükséges szerepek hívhassák a SECURITY DEFINER függvényeket

REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.tenant_has_module(uuid, public.app_module) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_has_module(uuid, public.app_module) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
