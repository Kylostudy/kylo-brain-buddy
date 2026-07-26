CREATE TABLE public.audit_scenarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  feature_tag TEXT,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'scenario',
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  prelude_block_ids UUID[] NOT NULL DEFAULT '{}',
  expectations JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_per_exam BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_exam_types (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  expected_features TEXT[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE public.audit_scenario_verdicts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  scenario_id UUID REFERENCES public.audit_scenarios(id) ON DELETE CASCADE,
  run_id UUID,
  exam_code TEXT,
  observer JSONB NOT NULL DEFAULT '{}'::jsonb,
  judge JSONB NOT NULL DEFAULT '{}'::jsonb,
  score INTEGER,
  passed BOOLEAN,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_scenarios_tenant ON public.audit_scenarios(tenant_id);
CREATE INDEX idx_audit_exam_types_tenant ON public.audit_exam_types(tenant_id);
CREATE INDEX idx_audit_scenario_verdicts_tenant ON public.audit_scenario_verdicts(tenant_id);
CREATE INDEX idx_audit_scenario_verdicts_run ON public.audit_scenario_verdicts(run_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_scenarios TO authenticated;
GRANT ALL ON public.audit_scenarios TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_exam_types TO authenticated;
GRANT ALL ON public.audit_exam_types TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_scenario_verdicts TO authenticated;
GRANT ALL ON public.audit_scenario_verdicts TO service_role;

ALTER TABLE public.audit_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_exam_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_scenario_verdicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scenarios tenant select" ON public.audit_scenarios FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));
CREATE POLICY "scenarios tenant insert" ON public.audit_scenarios FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));
CREATE POLICY "scenarios tenant update" ON public.audit_scenarios FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module))
  WITH CHECK (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));
CREATE POLICY "scenarios tenant delete" ON public.audit_scenarios FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));

CREATE POLICY "exam types tenant select" ON public.audit_exam_types FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));
CREATE POLICY "exam types tenant insert" ON public.audit_exam_types FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));
CREATE POLICY "exam types tenant update" ON public.audit_exam_types FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module))
  WITH CHECK (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));
CREATE POLICY "exam types tenant delete" ON public.audit_exam_types FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));

CREATE POLICY "verdicts tenant select" ON public.audit_scenario_verdicts FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));
CREATE POLICY "verdicts tenant insert" ON public.audit_scenario_verdicts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));
CREATE POLICY "verdicts tenant update" ON public.audit_scenario_verdicts FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module))
  WITH CHECK (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));
CREATE POLICY "verdicts tenant delete" ON public.audit_scenario_verdicts FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));

CREATE TRIGGER audit_scenarios_updated_at BEFORE UPDATE ON public.audit_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER audit_exam_types_updated_at BEFORE UPDATE ON public.audit_exam_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();