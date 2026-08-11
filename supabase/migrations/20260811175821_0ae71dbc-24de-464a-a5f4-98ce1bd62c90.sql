CREATE TABLE public.ui_recon_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workflow_id uuid,
  run_id uuid,
  platform text NOT NULL,
  page_type text NOT NULL,
  url text NOT NULL DEFAULT '',
  screenshot_path text,
  dom_digest jsonb NOT NULL DEFAULT '{}'::jsonb,
  analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  learned_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  changed boolean NOT NULL DEFAULT false,
  change_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ui_recon_snapshots_lookup
  ON public.ui_recon_snapshots (tenant_id, platform, page_type, created_at DESC);

GRANT SELECT ON public.ui_recon_snapshots TO authenticated;
GRANT ALL ON public.ui_recon_snapshots TO service_role;

ALTER TABLE public.ui_recon_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ui_recon_snapshots_select_own_tenant"
  ON public.ui_recon_snapshots FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.tenant_has_module(tenant_id, 'brain'::app_module)
  );