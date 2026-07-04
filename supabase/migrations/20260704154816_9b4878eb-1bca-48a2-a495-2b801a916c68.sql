CREATE TABLE public.brain_task_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kylogic_task_id text NOT NULL,
  tenant_id uuid NOT NULL,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  platform text,
  language text,
  region text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_local timestamp NULL,
  scheduled_utc timestamptz NULL,
  jitter_applied_seconds integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  result jsonb,
  error text,
  kylogic_callback_url text NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brain_task_queue_kylogic_workflow_unique
    UNIQUE (kylogic_task_id, workflow_id),
  CONSTRAINT brain_task_queue_status_check
    CHECK (status IN (
      'queued','running','succeeded','failed',
      'deferred_to_next_day','account_busy','cancelled'
    )),
  CONSTRAINT brain_task_queue_task_type_check
    CHECK (task_type IN ('publish_video','post_comment_reply','ping'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brain_task_queue TO authenticated;
GRANT ALL ON public.brain_task_queue TO service_role;

ALTER TABLE public.brain_task_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant reads own brain tasks"
  ON public.brain_task_queue
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND tenant_has_module(tenant_id, 'brain'::app_module)
  );

CREATE INDEX idx_btq_tenant_due
  ON public.brain_task_queue (tenant_id, scheduled_utc)
  WHERE status = 'queued';

CREATE INDEX idx_btq_workflow_status
  ON public.brain_task_queue (workflow_id, status);

CREATE INDEX idx_btq_kylogic
  ON public.brain_task_queue (kylogic_task_id);

CREATE TRIGGER brain_task_queue_touch
  BEFORE UPDATE ON public.brain_task_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
