ALTER TABLE public.audit_scenarios
  ADD COLUMN workflow_id UUID REFERENCES public.workflows(id) ON DELETE SET NULL,
  ADD COLUMN base_url TEXT NOT NULL DEFAULT 'https://kylo.study';

CREATE INDEX idx_audit_scenarios_workflow ON public.audit_scenarios(workflow_id);