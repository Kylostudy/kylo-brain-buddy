
ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS cookie_jar_country text,
  ADD COLUMN IF NOT EXISTS cookie_jar_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cookie_jar_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS cookie_jar_stats jsonb;
