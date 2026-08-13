update public.brain_task_queue
set status='queued', started_at=null
where status='running' and task_type='stt_media_fetch' and started_at < now() - interval '1 hour';