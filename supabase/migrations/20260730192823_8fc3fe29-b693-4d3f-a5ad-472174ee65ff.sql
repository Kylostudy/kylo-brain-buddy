ALTER TABLE public.proxies
  ADD COLUMN IF NOT EXISTS health_infra_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_success_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_last_infra_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS health_last_infra_code text,
  ADD COLUMN IF NOT EXISTS health_avg_latency_ms integer,
  ADD COLUMN IF NOT EXISTS health_paused_until timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_proxies_health_paused_until
  ON public.proxies (health_paused_until);