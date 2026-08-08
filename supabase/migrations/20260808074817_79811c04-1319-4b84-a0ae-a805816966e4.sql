CREATE TABLE public.vault_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  path text NOT NULL,
  label text,
  enabled boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'discovered',
  size_bytes bigint,
  file_count integer,
  last_synced_at timestamptz,
  last_error text,
  seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, path)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_folders TO authenticated;
GRANT ALL ON public.vault_folders TO service_role;
ALTER TABLE public.vault_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vault_folders_tenant_select" ON public.vault_folders
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "vault_folders_tenant_update" ON public.vault_folders
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "vault_folders_tenant_insert" ON public.vault_folders
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "vault_folders_tenant_delete" ON public.vault_folders
  FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE TRIGGER vault_folders_updated_at BEFORE UPDATE ON public.vault_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.vault_status (
  tenant_id uuid PRIMARY KEY,
  host text,
  luks_unlocked boolean,
  mount_ok boolean,
  disk_total_bytes bigint,
  disk_used_bytes bigint,
  disk_free_bytes bigint,
  mirror_used_bytes bigint,
  mirror_ok boolean,
  last_mirror_at timestamptz,
  last_error text,
  snapshots jsonb NOT NULL DEFAULT '[]'::jsonb,
  agent_version text,
  reported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.vault_status TO authenticated;
GRANT ALL ON public.vault_status TO service_role;
ALTER TABLE public.vault_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vault_status_tenant_select" ON public.vault_status
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE TRIGGER vault_status_updated_at BEFORE UPDATE ON public.vault_status
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();