
-- ============================================================
-- Brain + Audit moduláris szétválasztás
-- ============================================================

-- 1) Modul enum-szerű domain (sima text + CHECK is jó, de enumot használunk a típusbiztonságért)
DO $$ BEGIN
  CREATE TYPE public.app_module AS ENUM ('brain', 'audit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) tenant_module_access tábla (SOC 2 audit nyomvonal)
CREATE TABLE IF NOT EXISTS public.tenant_module_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  module public.app_module NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid NULL,
  revoked_at timestamptz NULL,
  revoked_by uuid NULL,
  source text NOT NULL DEFAULT 'manual_dev' CHECK (source IN ('hub', 'manual_dev')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Egy tenantnak egy modulhoz csak egy aktív (nem visszavont) jogosultsága lehet
CREATE UNIQUE INDEX IF NOT EXISTS tenant_module_access_active_uidx
  ON public.tenant_module_access (tenant_id, module)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_module_access_tenant_idx
  ON public.tenant_module_access (tenant_id);

GRANT SELECT ON public.tenant_module_access TO authenticated;
GRANT ALL ON public.tenant_module_access TO service_role;

ALTER TABLE public.tenant_module_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant can read own module access"
  ON public.tenant_module_access
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- INSERT/UPDATE/DELETE-et nem adunk az authenticated szerepnek: csak service_role írhat
-- (a Hub webhook, illetve dev seed). Így biztos nem önműködően ad jogot magának egy tenant.

CREATE TRIGGER trg_tenant_module_access_updated_at
  BEFORE UPDATE ON public.tenant_module_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Helper: tenant_has_module() — RLS-ből rekurzió-mentesen hívható
CREATE OR REPLACE FUNCTION public.tenant_has_module(_tenant_id uuid, _module public.app_module)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_module_access
    WHERE tenant_id = _tenant_id
      AND module = _module
      AND revoked_at IS NULL
  );
$$;

-- 4) workflows.module oszlop
ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS module public.app_module NOT NULL DEFAULT 'brain';

CREATE INDEX IF NOT EXISTS workflows_tenant_module_idx
  ON public.workflows (tenant_id, module, updated_at DESC);

-- Új, modul-tudatos RLS policy-k a workflows táblán
DROP POLICY IF EXISTS "Tenant can read own workflows" ON public.workflows;
DROP POLICY IF EXISTS "Tenant can insert own workflows" ON public.workflows;
DROP POLICY IF EXISTS "Tenant can update own workflows" ON public.workflows;
DROP POLICY IF EXISTS "Tenant can delete own workflows" ON public.workflows;

CREATE POLICY "Tenant can read own workflows"
  ON public.workflows FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, module)
  );

CREATE POLICY "Tenant can insert own workflows"
  ON public.workflows FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, module)
  );

CREATE POLICY "Tenant can update own workflows"
  ON public.workflows FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, module)
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, module)
  );

CREATE POLICY "Tenant can delete own workflows"
  ON public.workflows FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, module)
  );

-- 5) workflow_runs → brain_workflow_runs (átnevezés)
ALTER TABLE IF EXISTS public.workflow_runs RENAME TO brain_workflow_runs;

-- Hozzáadjuk a module oszlopot brain-ként (CHECK belt-and-suspenders)
ALTER TABLE public.brain_workflow_runs
  ADD COLUMN IF NOT EXISTS module public.app_module NOT NULL DEFAULT 'brain'
  CHECK (module = 'brain');

-- Hozzáadjuk a Hub-szinkron időbélyeget
ALTER TABLE public.brain_workflow_runs
  ADD COLUMN IF NOT EXISTS synced_to_hub_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS brain_workflow_runs_sync_idx
  ON public.brain_workflow_runs (synced_to_hub_at);

-- Új, modul-tudatos RLS a brain_workflow_runs táblán
DROP POLICY IF EXISTS "Tenant can read own workflow runs" ON public.brain_workflow_runs;
DROP POLICY IF EXISTS "Tenant can insert own workflow runs" ON public.brain_workflow_runs;
DROP POLICY IF EXISTS "Tenant can update own workflow runs" ON public.brain_workflow_runs;
DROP POLICY IF EXISTS "Tenant can delete own workflow runs" ON public.brain_workflow_runs;

CREATE POLICY "Tenant can read own brain runs"
  ON public.brain_workflow_runs FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, 'brain')
  );

CREATE POLICY "Tenant can insert own brain runs"
  ON public.brain_workflow_runs FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, 'brain')
  );

CREATE POLICY "Tenant can update own brain runs"
  ON public.brain_workflow_runs FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, 'brain')
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, 'brain')
  );

CREATE POLICY "Tenant can delete own brain runs"
  ON public.brain_workflow_runs FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, 'brain')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brain_workflow_runs TO authenticated;
GRANT ALL ON public.brain_workflow_runs TO service_role;

-- 6) audit_workflow_runs (új tábla, strukturálisan azonos a brain táblával)
CREATE TABLE IF NOT EXISTS public.audit_workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  runner text NOT NULL DEFAULT 'steel',
  status text NOT NULL DEFAULT 'queued',
  spec_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_id text NULL,
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb NULL,
  error text NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  module public.app_module NOT NULL DEFAULT 'audit' CHECK (module = 'audit'),
  synced_to_hub_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_workflow_runs_workflow_idx
  ON public.audit_workflow_runs (workflow_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_workflow_runs_status_idx
  ON public.audit_workflow_runs (status)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS audit_workflow_runs_sync_idx
  ON public.audit_workflow_runs (synced_to_hub_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_workflow_runs TO authenticated;
GRANT ALL ON public.audit_workflow_runs TO service_role;

ALTER TABLE public.audit_workflow_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant can read own audit runs"
  ON public.audit_workflow_runs FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, 'audit')
  );

CREATE POLICY "Tenant can insert own audit runs"
  ON public.audit_workflow_runs FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, 'audit')
  );

CREATE POLICY "Tenant can update own audit runs"
  ON public.audit_workflow_runs FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, 'audit')
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, 'audit')
  );

CREATE POLICY "Tenant can delete own audit runs"
  ON public.audit_workflow_runs FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, 'audit')
  );

CREATE TRIGGER trg_audit_workflow_runs_updated_at
  BEFORE UPDATE ON public.audit_workflow_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7) Dev seed: a meglévő egy tenantnak adjunk mindkét modulhoz hozzáférést
-- (üres rendszer, de van egy dev profil — később a Hub kezeli)
INSERT INTO public.tenant_module_access (tenant_id, module, source)
SELECT DISTINCT NULLIF(tenant_id, '')::uuid, 'brain'::public.app_module, 'manual_dev'
FROM public.profiles
WHERE tenant_id IS NOT NULL AND tenant_id <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.tenant_module_access (tenant_id, module, source)
SELECT DISTINCT NULLIF(tenant_id, '')::uuid, 'audit'::public.app_module, 'manual_dev'
FROM public.profiles
WHERE tenant_id IS NOT NULL AND tenant_id <> ''
ON CONFLICT DO NOTHING;
