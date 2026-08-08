CREATE TABLE public.vault_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  path text NOT NULL,
  label text,
  token text NOT NULL UNIQUE,
  password_hash text,
  expires_at timestamptz NOT NULL,
  max_downloads integer,
  download_count integer NOT NULL DEFAULT 0,
  allow_download boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  last_access_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vault_shares_token ON public.vault_shares (token);
CREATE INDEX idx_vault_shares_tenant ON public.vault_shares (tenant_id, created_at DESC);

GRANT SELECT ON public.vault_shares TO authenticated;
GRANT ALL ON public.vault_shares TO service_role;
ALTER TABLE public.vault_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vault_shares_select_own_tenant"
  ON public.vault_shares FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE TRIGGER vault_shares_updated_at
  BEFORE UPDATE ON public.vault_shares
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.vault_share_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid REFERENCES public.vault_shares(id) ON DELETE CASCADE,
  token_attempted text,
  ts timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text,
  outcome text NOT NULL
);

CREATE INDEX idx_vault_share_access_share ON public.vault_share_access (share_id, ts DESC);
CREATE INDEX idx_vault_share_access_ip ON public.vault_share_access (ip, ts DESC);

GRANT SELECT ON public.vault_share_access TO authenticated;
GRANT ALL ON public.vault_share_access TO service_role;
ALTER TABLE public.vault_share_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vault_share_access_select_own_tenant"
  ON public.vault_share_access FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vault_shares s
    WHERE s.id = vault_share_access.share_id
      AND s.tenant_id = public.current_tenant_id()
  ));

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'vault-shares-cleanup',
  '17 3 * * *',
  $$
  DELETE FROM public.vault_shares
   WHERE (expires_at < now() - interval '30 days')
      OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days');
  DELETE FROM public.vault_share_access
   WHERE share_id IS NULL AND ts < now() - interval '30 days';
  $$
);
