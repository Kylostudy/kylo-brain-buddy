ALTER TABLE public.recording_sessions
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'record';

ALTER TABLE public.recording_sessions
  DROP CONSTRAINT IF EXISTS recording_sessions_mode_check;
ALTER TABLE public.recording_sessions
  ADD CONSTRAINT recording_sessions_mode_check CHECK (mode IN ('record', 'browse'));

CREATE INDEX IF NOT EXISTS recording_sessions_workflow_active_idx
  ON public.recording_sessions (workflow_id)
  WHERE status IN ('requested', 'active');