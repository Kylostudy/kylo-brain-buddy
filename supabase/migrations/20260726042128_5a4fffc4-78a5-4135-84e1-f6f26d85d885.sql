UPDATE public.brain_workflow_runs
SET status = 'failed',
    finished_at = now(),
    error = COALESCE(NULLIF(error, ''), 'watchdog: manuálisan lezárva — 7h+ nem érkezett életjel a workertől')
WHERE id = 'dc5e5e62-0a21-4f33-9e25-81c4269669e2'
  AND status = 'running';

CREATE OR REPLACE FUNCTION public.fail_stuck_brain_runs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  WITH stuck AS (
    UPDATE public.brain_workflow_runs
    SET status = 'failed',
        finished_at = now(),
        error = COALESCE(
          NULLIF(error, ''),
          format('watchdog: beragadt „running" — utolsó életjel %s perce', (extract(epoch FROM (now() - updated_at))::int / 60))
        )
    WHERE status = 'running'
      AND updated_at < now() - interval '15 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO affected FROM stuck;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_stuck_brain_runs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_stuck_brain_runs() FROM anon;
REVOKE ALL ON FUNCTION public.fail_stuck_brain_runs() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fail_stuck_brain_runs() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('fail-stuck-brain-runs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'fail-stuck-brain-runs',
  '* * * * *',
  $$SELECT public.fail_stuck_brain_runs();$$
);