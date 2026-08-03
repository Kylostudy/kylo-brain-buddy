UPDATE public.brain_task_queue
SET status = 'queued',
    scheduled_utc = now(),
    started_at = NULL,
    completed_at = NULL,
    error = NULL,
    result = NULL,
    payload = jsonb_set(payload::jsonb, '{want}', '["audio"]'::jsonb, true),
    attempt_count = attempt_count + 1
WHERE id IN (
  '40f8cc8d-5cbd-4c38-bf21-c0a94addc65c',
  '3d84b71a-1205-44d4-88c9-748cc6a01ba7',
  '99ccdb44-e7fa-429a-965e-37a57dc05bd4'
);