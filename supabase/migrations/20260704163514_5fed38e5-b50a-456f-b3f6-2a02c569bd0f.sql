ALTER TABLE public.brain_workflow_runs
  ADD COLUMN IF NOT EXISTS brain_task_id uuid
    REFERENCES public.brain_task_queue(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_brain_workflow_runs_task_id
  ON public.brain_workflow_runs(brain_task_id)
  WHERE brain_task_id IS NOT NULL;