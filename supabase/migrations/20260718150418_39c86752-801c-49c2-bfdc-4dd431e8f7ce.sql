
CREATE TABLE public.audit_qa_expected_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  path text NOT NULL,
  note text,
  requires_auth boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, path)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_qa_expected_routes TO authenticated;
GRANT ALL ON public.audit_qa_expected_routes TO service_role;

ALTER TABLE public.audit_qa_expected_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qa_exp tenant select" ON public.audit_qa_expected_routes
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));

CREATE POLICY "qa_exp tenant insert" ON public.audit_qa_expected_routes
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));

CREATE POLICY "qa_exp tenant update" ON public.audit_qa_expected_routes
  FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));

CREATE POLICY "qa_exp tenant delete" ON public.audit_qa_expected_routes
  FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_has_module(tenant_id, 'audit'::app_module));

CREATE TRIGGER audit_qa_expected_routes_updated_at
  BEFORE UPDATE ON public.audit_qa_expected_routes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_audit_qa_expected_routes_tenant ON public.audit_qa_expected_routes (tenant_id);
