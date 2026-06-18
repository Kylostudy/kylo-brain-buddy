
CREATE TABLE public.workflows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  name TEXT NOT NULL DEFAULT 'Új workflow',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_workflow_id ON public.messages(workflow_id, created_at);
CREATE INDEX idx_workflows_tenant ON public.workflows(tenant_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflows TO anon, authenticated;
GRANT ALL ON public.workflows TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO anon, authenticated;
GRANT ALL ON public.messages TO service_role;

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- DEV: tenant_id = 0. tenant, no auth yet. Permissive policies, will be replaced by Core Hub tenant scoping later.
CREATE POLICY "dev_all_workflows" ON public.workflows FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "dev_all_messages" ON public.messages FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_workflow_updated_at() RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.workflows SET updated_at = now() WHERE id = NEW.workflow_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER messages_touch_workflow
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.touch_workflow_updated_at();
