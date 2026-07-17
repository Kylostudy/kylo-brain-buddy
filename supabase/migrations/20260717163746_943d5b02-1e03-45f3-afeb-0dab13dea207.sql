
-- Audit QA (kylo.study tesztelő) — futások, hibák, coverage.

-- 1) audit_qa_runs
CREATE TABLE public.audit_qa_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  workflow_id UUID REFERENCES public.workflows(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','stopped')),
  base_url TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_pages_visited INT NOT NULL DEFAULT 0,
  total_issues_found INT NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  cost_cap_usd NUMERIC(10,4),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_qa_runs TO authenticated;
GRANT ALL ON public.audit_qa_runs TO service_role;
ALTER TABLE public.audit_qa_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qa_runs tenant select" ON public.audit_qa_runs FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'));
CREATE POLICY "qa_runs tenant insert" ON public.audit_qa_runs FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'));
CREATE POLICY "qa_runs tenant update" ON public.audit_qa_runs FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'))
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "qa_runs tenant delete" ON public.audit_qa_runs FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'));

CREATE TRIGGER trg_audit_qa_runs_updated
  BEFORE UPDATE ON public.audit_qa_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_audit_qa_runs_tenant ON public.audit_qa_runs(tenant_id, started_at DESC);

-- 2) audit_qa_issues
CREATE TABLE public.audit_qa_issues (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.audit_qa_runs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','major','minor','info')),
  category TEXT NOT NULL CHECK (category IN (
    'translation_missing','translation_wrong','contrast','missing_back_button',
    'broken_layout','clipped_text','navigation_dead_end','console_error','other'
  )),
  language TEXT,
  skin TEXT,
  page_url TEXT NOT NULL,
  page_title TEXT,
  expected_language TEXT,
  detected_language TEXT,
  problematic_text TEXT,
  selector TEXT,
  dom_context JSONB,
  ai_diagnosis TEXT,
  ai_suggested_fix TEXT,
  screenshot_path TEXT,
  screenshot_annotated_path TEXT,
  dedupe_hash TEXT NOT NULL,
  occurrence_count INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','fixed','wont_fix','duplicate')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (run_id, dedupe_hash)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_qa_issues TO authenticated;
GRANT ALL ON public.audit_qa_issues TO service_role;
ALTER TABLE public.audit_qa_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qa_issues tenant select" ON public.audit_qa_issues FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'));
CREATE POLICY "qa_issues tenant insert" ON public.audit_qa_issues FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'));
CREATE POLICY "qa_issues tenant update" ON public.audit_qa_issues FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'))
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "qa_issues tenant delete" ON public.audit_qa_issues FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'));

CREATE TRIGGER trg_audit_qa_issues_updated
  BEFORE UPDATE ON public.audit_qa_issues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_audit_qa_issues_run ON public.audit_qa_issues(run_id, severity, category);
CREATE INDEX idx_audit_qa_issues_tenant ON public.audit_qa_issues(tenant_id, status);

-- 3) audit_qa_coverage
CREATE TABLE public.audit_qa_coverage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.audit_qa_runs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  url TEXT NOT NULL,
  language TEXT,
  skin TEXT,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  interactions_count INT NOT NULL DEFAULT 0,
  screenshot_hash TEXT,
  UNIQUE (run_id, url, language, skin)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_qa_coverage TO authenticated;
GRANT ALL ON public.audit_qa_coverage TO service_role;
ALTER TABLE public.audit_qa_coverage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qa_cov tenant select" ON public.audit_qa_coverage FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'));
CREATE POLICY "qa_cov tenant insert" ON public.audit_qa_coverage FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'));
CREATE POLICY "qa_cov tenant delete" ON public.audit_qa_coverage FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'));

CREATE INDEX idx_audit_qa_coverage_run ON public.audit_qa_coverage(run_id, visited_at DESC);
