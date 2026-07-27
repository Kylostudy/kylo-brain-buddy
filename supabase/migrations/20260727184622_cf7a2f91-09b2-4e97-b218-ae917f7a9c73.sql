CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  cpu_percent numeric,
  load1 numeric,
  load5 numeric,
  mem_total_mb integer,
  mem_used_mb integer,
  mem_percent numeric,
  disk_percent numeric,
  containers_running integer,
  inflight_jobs integer,
  uptime_seconds bigint,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS worker_heartbeats_created_at_idx ON public.worker_heartbeats (created_at DESC);
CREATE INDEX IF NOT EXISTS worker_heartbeats_worker_idx ON public.worker_heartbeats (worker_id, created_at DESC);

GRANT SELECT ON public.worker_heartbeats TO authenticated;
GRANT ALL ON public.worker_heartbeats TO service_role;

ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read worker heartbeats" ON public.worker_heartbeats;
CREATE POLICY "authenticated can read worker heartbeats"
ON public.worker_heartbeats FOR SELECT TO authenticated USING (true);

-- Ma estére nem futtatunk tesztet: a sorban álló futások visszavonása
UPDATE public.brain_workflow_runs
SET status = 'cancelled', finished_at = now(), error = COALESCE(NULLIF(error,''), 'manuálisan visszavonva (ma este nincs teszt)')
WHERE status = 'queued';