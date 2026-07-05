
ALTER TABLE public.proxies
  ADD COLUMN IF NOT EXISTS fingerprint_user_agent text,
  ADD COLUMN IF NOT EXISTS fingerprint_locale text,
  ADD COLUMN IF NOT EXISTS fingerprint_timezone text,
  ADD COLUMN IF NOT EXISTS fingerprint_viewport_w int,
  ADD COLUMN IF NOT EXISTS fingerprint_viewport_h int,
  ADD COLUMN IF NOT EXISTS fingerprint_platform text,
  ADD COLUMN IF NOT EXISTS fingerprint_seed text,
  ADD COLUMN IF NOT EXISTS warmup_language text,
  ADD COLUMN IF NOT EXISTS warmup_country_sites text[],
  ADD COLUMN IF NOT EXISTS warmup_last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS warmup_next_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS warmup_running_at timestamptz;
