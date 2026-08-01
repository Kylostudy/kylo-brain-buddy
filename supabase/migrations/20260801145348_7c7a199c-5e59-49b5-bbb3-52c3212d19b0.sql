WITH base AS (
  SELECT id, workflow_id, tenant_id, runner, module, proxy_id, spec_snapshot,
         (spec_snapshot->'kylo_signup'->>'expected_country') AS c
  FROM public.brain_workflow_runs
  WHERE id IN ('b37bd673-0ca5-4edc-b752-5eb0137ffb0f','4902a9fa-837b-4214-bd34-9b9602a48f23')
), mx AS (
  SELECT COALESCE(MAX((spec_snapshot->'kylo_signup'->>'run_index')::int),0) AS m
  FROM public.brain_workflow_runs
  WHERE spec_snapshot->'kylo_signup'->>'run_index' IS NOT NULL
), numbered AS (
  SELECT b.*, mx.m + ROW_NUMBER() OVER (ORDER BY CASE WHEN b.c='FR' THEN 0 ELSE 1 END) AS new_idx
  FROM base b CROSS JOIN mx
)
INSERT INTO public.brain_workflow_runs (workflow_id, tenant_id, runner, module, status, proxy_id, spec_snapshot, logs)
SELECT workflow_id, tenant_id, runner, module, 'queued', proxy_id,
  jsonb_set(
    jsonb_set(spec_snapshot,
      '{kylo_signup}',
      (spec_snapshot->'kylo_signup')
        || jsonb_build_object(
             'run_index', new_idx,
             'email', 'sunyika.crypto+kylo' || new_idx || '@gmail.com'
           )
    ),
    '{account_label}',
    to_jsonb('Kylo Sign Up #' || new_idx || ' · ' || c || ' · alaszka')
  ),
  '[]'::jsonb
FROM numbered;