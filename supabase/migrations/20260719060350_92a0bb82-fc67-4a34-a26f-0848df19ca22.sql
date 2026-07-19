-- Kylo Audit QA — ütemezett futások tábla.
-- A UI-ban létrehozott presetet (fordítás / megjelenés / egyéni) egy cron
-- kifejezéssel bekötjük, a szerver oldali cron route pedig futtatáshoz sorba
-- teszi a QA-t (diff-móddal), így nulla kézi munka a napi ellenőrzés.

CREATE TABLE public.audit_qa_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  workflow_id UUID REFERENCES public.workflows(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Budapest',
  base_url TEXT NOT NULL DEFAULT 'https://kylo.study',
  languages TEXT[] NOT NULL,
  skins TEXT[] NOT NULL,
  diff_mode BOOLEAN NOT NULL DEFAULT true,
  cost_cap_usd NUMERIC NOT NULL DEFAULT 50,
  max_pages_per_combo INT NOT NULL DEFAULT 300,
  preset TEXT,
  last_run_at TIMESTAMPTZ,
  last_run_id UUID,
  last_run_status TEXT,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_qa_schedules_due
  ON public.audit_qa_schedules (enabled, next_run_at)
  WHERE enabled = true;

CREATE INDEX idx_audit_qa_schedules_tenant
  ON public.audit_qa_schedules (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_qa_schedules TO authenticated;
GRANT ALL ON public.audit_qa_schedules TO service_role;

ALTER TABLE public.audit_qa_schedules ENABLE ROW LEVEL SECURITY;

-- Tenant tagok csak a saját ütemezéseiket látják és kezelik.
CREATE POLICY "Tenant members read own schedules"
ON public.audit_qa_schedules
FOR SELECT
TO authenticated
USING (tenant_id = public.current_tenant_id());

CREATE POLICY "Tenant members insert own schedules"
ON public.audit_qa_schedules
FOR INSERT
TO authenticated
WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "Tenant members update own schedules"
ON public.audit_qa_schedules
FOR UPDATE
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "Tenant members delete own schedules"
ON public.audit_qa_schedules
FOR DELETE
TO authenticated
USING (tenant_id = public.current_tenant_id());

CREATE TRIGGER update_audit_qa_schedules_updated_at
BEFORE UPDATE ON public.audit_qa_schedules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();