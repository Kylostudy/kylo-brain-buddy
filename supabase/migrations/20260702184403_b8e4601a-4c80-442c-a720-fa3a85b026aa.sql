
ALTER TABLE public.brain_workflow_runs
  ADD COLUMN IF NOT EXISTS proxy_id uuid REFERENCES public.proxies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preflight_result jsonb;

CREATE INDEX IF NOT EXISTS brain_workflow_runs_proxy_id_idx
  ON public.brain_workflow_runs(proxy_id);
