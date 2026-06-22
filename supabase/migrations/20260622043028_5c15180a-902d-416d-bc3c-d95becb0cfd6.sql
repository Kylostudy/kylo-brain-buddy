
-- 1) Drop overly permissive dev policies
DROP POLICY IF EXISTS dev_all_messages ON public.messages;
DROP POLICY IF EXISTS dev_all_workflows ON public.workflows;
DROP POLICY IF EXISTS dev_all_workflow_runs ON public.workflow_runs;
DROP POLICY IF EXISTS dev_all_workflow_credentials ON public.workflow_credentials;

-- 2) Revoke anon and authenticated access on server-only tables
REVOKE ALL ON public.workflows FROM anon;
REVOKE ALL ON public.workflow_runs FROM anon;
REVOKE ALL ON public.workflow_credentials FROM anon;
REVOKE ALL ON public.messages FROM anon;
REVOKE ALL ON public.kit_incoming_tasks FROM anon, authenticated;
REVOKE ALL ON public.kit_incoming_task_log FROM anon, authenticated;
REVOKE ALL ON public.cross_module_tenant_cache FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_credentials TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;

GRANT ALL ON public.workflows TO service_role;
GRANT ALL ON public.workflow_runs TO service_role;
GRANT ALL ON public.workflow_credentials TO service_role;
GRANT ALL ON public.messages TO service_role;
GRANT ALL ON public.kit_incoming_tasks TO service_role;
GRANT ALL ON public.kit_incoming_task_log TO service_role;
GRANT ALL ON public.cross_module_tenant_cache TO service_role;

-- 3) Security-definer helper (profiles.tenant_id is text; workflows.tenant_id is uuid)
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(tenant_id, '')::uuid FROM public.profiles WHERE id = auth.uid()
$$;

-- 4) handle_new_user: also set tenant_id (single-user tenant model)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, tenant_id, tenant_id_resolved_at)
  VALUES (NEW.id, NEW.email, NEW.id::text, now())
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    tenant_id = COALESCE(NULLIF(public.profiles.tenant_id, ''), EXCLUDED.tenant_id),
    tenant_id_resolved_at = COALESCE(public.profiles.tenant_id_resolved_at, EXCLUDED.tenant_id_resolved_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5) workflows policies
CREATE POLICY "Tenant can read own workflows"
  ON public.workflows FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant can insert own workflows"
  ON public.workflows FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant can update own workflows"
  ON public.workflows FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant can delete own workflows"
  ON public.workflows FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- 6) workflow_runs scoped via parent workflow
CREATE POLICY "Tenant can read own workflow runs"
  ON public.workflow_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_runs.workflow_id AND w.tenant_id = public.current_tenant_id()));
CREATE POLICY "Tenant can insert own workflow runs"
  ON public.workflow_runs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_runs.workflow_id AND w.tenant_id = public.current_tenant_id()));
CREATE POLICY "Tenant can update own workflow runs"
  ON public.workflow_runs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_runs.workflow_id AND w.tenant_id = public.current_tenant_id()));
CREATE POLICY "Tenant can delete own workflow runs"
  ON public.workflow_runs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_runs.workflow_id AND w.tenant_id = public.current_tenant_id()));

-- 7) workflow_credentials scoped via parent workflow
CREATE POLICY "Tenant can read own credentials"
  ON public.workflow_credentials FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_credentials.workflow_id AND w.tenant_id = public.current_tenant_id()));
CREATE POLICY "Tenant can insert own credentials"
  ON public.workflow_credentials FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_credentials.workflow_id AND w.tenant_id = public.current_tenant_id()));
CREATE POLICY "Tenant can update own credentials"
  ON public.workflow_credentials FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_credentials.workflow_id AND w.tenant_id = public.current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_credentials.workflow_id AND w.tenant_id = public.current_tenant_id()));
CREATE POLICY "Tenant can delete own credentials"
  ON public.workflow_credentials FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_credentials.workflow_id AND w.tenant_id = public.current_tenant_id()));

-- 8) messages scoped via parent workflow
CREATE POLICY "Tenant can read own messages"
  ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = messages.workflow_id AND w.tenant_id = public.current_tenant_id()));
CREATE POLICY "Tenant can insert own messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = messages.workflow_id AND w.tenant_id = public.current_tenant_id()));
CREATE POLICY "Tenant can update own messages"
  ON public.messages FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = messages.workflow_id AND w.tenant_id = public.current_tenant_id()));
CREATE POLICY "Tenant can delete own messages"
  ON public.messages FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = messages.workflow_id AND w.tenant_id = public.current_tenant_id()));

-- 9) Explicit service-role-only policies on server-to-server tables
CREATE POLICY "Service role only" ON public.kit_incoming_tasks
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role only" ON public.kit_incoming_task_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role only" ON public.cross_module_tenant_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);
