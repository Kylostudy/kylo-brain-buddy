CREATE TABLE public.vault_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  hostname text,
  platform text,
  version text,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.vault_agents TO service_role;
ALTER TABLE public.vault_agents ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_vault_agents_tenant ON public.vault_agents(tenant_id);

CREATE TABLE public.vault_agent_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.vault_agents(id) ON DELETE CASCADE,
  path text NOT NULL,
  label text,
  file_count integer NOT NULL DEFAULT 0,
  size_bytes bigint NOT NULL DEFAULT 0,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, path)
);
GRANT ALL ON public.vault_agent_folders TO service_role;
ALTER TABLE public.vault_agent_folders ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.vault_agent_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.vault_agents(id) ON DELETE CASCADE,
  folder_id uuid NOT NULL REFERENCES public.vault_agent_folders(id) ON DELETE CASCADE,
  rel text NOT NULL,
  size bigint NOT NULL DEFAULT 0,
  mtime bigint,
  hash text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (folder_id, rel)
);
GRANT ALL ON public.vault_agent_files TO service_role;
ALTER TABLE public.vault_agent_files ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_vault_agent_files_agent ON public.vault_agent_files(agent_id);

CREATE TABLE public.vault_pair_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  tenant_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.vault_pair_codes TO service_role;
ALTER TABLE public.vault_pair_codes ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.vault_agent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  agent_id uuid,
  event text NOT NULL,
  ip text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.vault_agent_events TO service_role;
ALTER TABLE public.vault_agent_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_vault_agent_events_ip_time ON public.vault_agent_events(ip, created_at DESC);

CREATE TRIGGER vault_agents_updated_at BEFORE UPDATE ON public.vault_agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER vault_agent_folders_updated_at BEFORE UPDATE ON public.vault_agent_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();