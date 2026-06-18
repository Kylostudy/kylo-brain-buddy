ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ready_for_test boolean NOT NULL DEFAULT false;