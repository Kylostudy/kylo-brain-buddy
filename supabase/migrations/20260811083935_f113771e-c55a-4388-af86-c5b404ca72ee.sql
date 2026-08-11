ALTER TABLE public.content_drafts
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_submit boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS content_drafts_scheduled_idx
  ON public.content_drafts (scheduled_for)
  WHERE scheduled_for IS NOT NULL;