
CREATE TABLE public.proxies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  label TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'isp',
  protocol TEXT NOT NULL DEFAULT 'http',
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username_ciphertext TEXT,
  username_nonce TEXT,
  password_ciphertext TEXT,
  password_nonce TEXT,
  notes TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proxies TO authenticated;
GRANT ALL ON public.proxies TO service_role;

ALTER TABLE public.proxies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant can read own proxies"
  ON public.proxies FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "Tenant can insert own proxies"
  ON public.proxies FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "Tenant can update own proxies"
  ON public.proxies FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "Tenant can delete own proxies"
  ON public.proxies FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE TRIGGER update_proxies_updated_at
  BEFORE UPDATE ON public.proxies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_proxies_tenant ON public.proxies(tenant_id);
