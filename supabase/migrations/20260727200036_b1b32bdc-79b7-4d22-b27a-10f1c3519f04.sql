CREATE TABLE public.audit_test_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  workflow_id uuid,
  run_id uuid,
  email text NOT NULL,
  password_ciphertext text NOT NULL,
  password_nonce text NOT NULL,
  run_index integer,
  skin text,
  country text,
  lang text,
  currency text,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  registered_at timestamp with time zone,
  last_login_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_test_accounts TO authenticated;
GRANT ALL ON public.audit_test_accounts TO service_role;

ALTER TABLE public.audit_test_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant can view own test accounts" ON public.audit_test_accounts
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'));
CREATE POLICY "tenant can insert own test accounts" ON public.audit_test_accounts
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'));
CREATE POLICY "tenant can update own test accounts" ON public.audit_test_accounts
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'));
CREATE POLICY "tenant can delete own test accounts" ON public.audit_test_accounts
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.tenant_has_module(tenant_id, 'audit'));

CREATE TRIGGER audit_test_accounts_updated_at
  BEFORE UPDATE ON public.audit_test_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX audit_test_accounts_tenant_created_idx ON public.audit_test_accounts (tenant_id, created_at DESC);