CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'cleanup-old-recording-sessions',
  '0 0 * * *',
  $$
  DELETE FROM public.recording_sessions
  WHERE status IN ('completed', 'cancelled', 'failed')
    AND COALESCE(ended_at, updated_at) < now() - interval '30 days';
  $$
);