CREATE TABLE public.kylogic_incoming_tasks (
  task_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  kylogic_user_id text,
  kylogic_callback_url text NOT NULL,
  task_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  error text,
  callback_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.kylogic_incoming_tasks TO service_role;

ALTER TABLE public.kylogic_incoming_tasks ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER kylogic_incoming_tasks_set_updated_at
BEFORE UPDATE ON public.kylogic_incoming_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.kylogic_incoming_task_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id text NOT NULL REFERENCES public.kylogic_incoming_tasks(task_id) ON DELETE CASCADE,
  event text NOT NULL,
  outcome text NOT NULL DEFAULT 'info',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.kylogic_incoming_task_log TO service_role;

ALTER TABLE public.kylogic_incoming_task_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX kylogic_incoming_task_log_task_idx ON public.kylogic_incoming_task_log(task_id, created_at);
CREATE INDEX kylogic_incoming_task_log_created_idx ON public.kylogic_incoming_task_log(created_at);