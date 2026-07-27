
CREATE TABLE public.workflow_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  module public.app_module NOT NULL DEFAULT 'brain',
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_folders TO authenticated;
GRANT ALL ON public.workflow_folders TO service_role;

ALTER TABLE public.workflow_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant can read own folders" ON public.workflow_folders
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant can insert own folders" ON public.workflow_folders
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant can update own folders" ON public.workflow_folders
  FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant can delete own folders" ON public.workflow_folders
  FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE TRIGGER update_workflow_folders_updated_at
  BEFORE UPDATE ON public.workflow_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workflows
  ADD COLUMN folder_id uuid REFERENCES public.workflow_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_workflows_folder_id ON public.workflows(folder_id);
