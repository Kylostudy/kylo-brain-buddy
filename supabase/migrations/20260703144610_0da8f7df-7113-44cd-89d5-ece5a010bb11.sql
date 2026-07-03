ALTER TABLE public.workflow_credentials
  ADD COLUMN IF NOT EXISTS proxy_id uuid REFERENCES public.proxies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS workflow_credentials_proxy_id_idx ON public.workflow_credentials(proxy_id);