UPDATE public.brain_task_queue
SET status = 'queued', updated_at = now()
WHERE task_type = 'stt_media_fetch'
  AND status = 'running'
  AND updated_at < now() - interval '30 minutes';