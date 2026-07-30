REVOKE EXECUTE ON FUNCTION public.is_platform_operator() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_operator() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_platform_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_operator() TO service_role;