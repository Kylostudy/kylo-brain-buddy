UPDATE public.brain_workflow_runs
SET status = 'cancelled',
    finished_at = now(),
    error = 'Batch manually cancelled by user request (duplicate 15-run batch)'
WHERE status = 'queued'
  AND module = 'audit'
  AND (spec_snapshot->'kylo_signup'->>'batch_id') = '42867541-88c3-4627-9eef-e64369a0bf20'
RETURNING id, (spec_snapshot->'kylo_signup'->>'run_index') as run_index;