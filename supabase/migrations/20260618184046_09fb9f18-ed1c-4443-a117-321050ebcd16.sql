CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.workflow_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  runner TEXT NOT NULL DEFAULT 'steel',
  status TEXT NOT NULL DEFAULT 'queued',
  spec_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_id TEXT,
  logs JSONB NOT NULL DEFAULT '[]'::jsonb,
  result JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflow_runs_workflow_id_idx ON public.workflow_runs(workflow_id, created_at DESC);
CREATE INDEX workflow_runs_status_idx ON public.workflow_runs(status) WHERE status IN ('queued','running');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_runs TO authenticated, anon;
GRANT ALL ON public.workflow_runs TO service_role;

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY dev_all_workflow_runs ON public.workflow_runs FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER trg_workflow_runs_updated_at
BEFORE UPDATE ON public.workflow_runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();