CREATE OR REPLACE FUNCTION public.is_platform_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_module_access tma
    WHERE tma.tenant_id = public.current_tenant_id()
      AND tma.revoked_at IS NULL
  )
$$;

REVOKE ALL ON FUNCTION public.is_platform_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_operator() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_operator() TO service_role;

DROP POLICY IF EXISTS "Authenticated users can view deploy requests" ON public.worker_deploy_requests;
DROP POLICY IF EXISTS "Operators can view their own deploy requests" ON public.worker_deploy_requests;
CREATE POLICY "Operators can view their own deploy requests"
ON public.worker_deploy_requests
FOR SELECT
TO authenticated
USING (requested_by = auth.uid() AND public.is_platform_operator());

DROP POLICY IF EXISTS "authenticated can read worker heartbeats" ON public.worker_heartbeats;
DROP POLICY IF EXISTS "Operators can read worker heartbeats" ON public.worker_heartbeats;
CREATE POLICY "Operators can read worker heartbeats"
ON public.worker_heartbeats
FOR SELECT
TO authenticated
USING (public.is_platform_operator());