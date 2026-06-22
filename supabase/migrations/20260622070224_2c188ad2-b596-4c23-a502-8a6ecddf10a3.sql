GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflows TO authenticated;
GRANT ALL ON public.workflows TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brain_workflow_runs TO authenticated;
GRANT ALL ON public.brain_workflow_runs TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_workflow_runs TO authenticated;
GRANT ALL ON public.audit_workflow_runs TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_credentials TO authenticated;
GRANT ALL ON public.workflow_credentials TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

GRANT SELECT ON public.tenant_module_access TO authenticated;
GRANT ALL ON public.tenant_module_access TO service_role;

GRANT ALL ON public.cross_module_tenant_cache TO service_role;
GRANT ALL ON public.kit_incoming_tasks TO service_role;
GRANT ALL ON public.kit_incoming_task_log TO service_role;