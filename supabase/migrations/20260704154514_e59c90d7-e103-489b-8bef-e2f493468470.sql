-- Phase 1: extend workflows for Kylogic filtered-mode dispatch

ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS platform  text,
  ADD COLUMN IF NOT EXISTS language  text,
  ADD COLUMN IF NOT EXISTS region    text,
  ADD COLUMN IF NOT EXISTS timezone  text,
  ADD COLUMN IF NOT EXISTS daily_cap integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS active    boolean NOT NULL DEFAULT true;

-- Guardrail: platform values must be from a known set (nullable while unset)
ALTER TABLE public.workflows
  DROP CONSTRAINT IF EXISTS workflows_platform_check;
ALTER TABLE public.workflows
  ADD CONSTRAINT workflows_platform_check
  CHECK (platform IS NULL OR platform IN (
    'tiktok','instagram','youtube','facebook','linkedin','pinterest','x'
  ));

-- Sanity bounds on daily_cap
ALTER TABLE public.workflows
  DROP CONSTRAINT IF EXISTS workflows_daily_cap_check;
ALTER TABLE public.workflows
  ADD CONSTRAINT workflows_daily_cap_check
  CHECK (daily_cap >= 0 AND daily_cap <= 50);

-- Fast lookup for the Kylogic filtered-mode selector
CREATE INDEX IF NOT EXISTS workflows_kylogic_filter_idx
  ON public.workflows (platform, language, region, active)
  WHERE module = 'brain';
