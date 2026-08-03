WITH q AS (
  UPDATE public.brain_task_queue t
  SET status = 'running', started_at = now()
  WHERE t.status = 'queued' AND t.task_type = 'stt_media_fetch'
  RETURNING t.id, t.workflow_id, t.tenant_id, t.task_type, t.payload, t.platform, t.language, t.region, t.kylogic_task_id
)
INSERT INTO public.brain_workflow_runs (workflow_id, tenant_id, runner, status, spec_snapshot, brain_task_id)
SELECT q.workflow_id, q.tenant_id, 'docker', 'queued',
  COALESCE(w.spec, '{}'::jsonb)
    || jsonb_build_object('platform', w.platform, 'region', w.region)
    || jsonb_build_object('brain_task', jsonb_build_object(
        'task_id', q.id,
        'kylogic_task_id', q.kylogic_task_id,
        'task_type', q.task_type,
        'payload', q.payload,
        'platform', q.platform,
        'language', q.language,
        'region', q.region
      )),
  q.id
FROM q JOIN public.workflows w ON w.id = q.workflow_id;