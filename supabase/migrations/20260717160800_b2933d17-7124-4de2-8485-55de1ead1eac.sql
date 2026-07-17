
-- 1) recording_sessions: use current_tenant_id() and require module entitlement via workflow
DROP POLICY IF EXISTS tenant_select_own_sessions ON public.recording_sessions;
DROP POLICY IF EXISTS tenant_insert_own_sessions ON public.recording_sessions;
DROP POLICY IF EXISTS tenant_update_own_sessions ON public.recording_sessions;
DROP POLICY IF EXISTS tenant_delete_own_sessions ON public.recording_sessions;

CREATE POLICY tenant_select_own_sessions ON public.recording_sessions
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = recording_sessions.workflow_id
        AND w.tenant_id = public.current_tenant_id()
        AND public.tenant_has_module(w.tenant_id, w.module)
    )
  );

CREATE POLICY tenant_insert_own_sessions ON public.recording_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = recording_sessions.workflow_id
        AND w.tenant_id = public.current_tenant_id()
        AND public.tenant_has_module(w.tenant_id, w.module)
    )
  );

CREATE POLICY tenant_update_own_sessions ON public.recording_sessions
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = recording_sessions.workflow_id
        AND w.tenant_id = public.current_tenant_id()
        AND public.tenant_has_module(w.tenant_id, w.module)
    )
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = recording_sessions.workflow_id
        AND w.tenant_id = public.current_tenant_id()
        AND public.tenant_has_module(w.tenant_id, w.module)
    )
  );

CREATE POLICY tenant_delete_own_sessions ON public.recording_sessions
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.workflows w
      WHERE w.id = recording_sessions.workflow_id
        AND w.tenant_id = public.current_tenant_id()
        AND public.tenant_has_module(w.tenant_id, w.module)
    )
  );

-- 2) worker_learned_selectors: remove broad authenticated SELECT; access via service_role only
DROP POLICY IF EXISTS "Authenticated users can view learned selectors" ON public.worker_learned_selectors;

-- 3) Revoke EXECUTE on trigger-only SECURITY DEFINER function from anon/authenticated/PUBLIC
REVOKE EXECUTE ON FUNCTION public.prevent_profile_tenant_id_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
