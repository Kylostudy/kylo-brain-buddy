CREATE TABLE public.recording_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  start_url text,
  worker_id text,
  action_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ended_at timestamptz
);

CREATE INDEX recording_sessions_workflow_idx ON public.recording_sessions(workflow_id);
CREATE INDEX recording_sessions_status_idx ON public.recording_sessions(status);
CREATE INDEX recording_sessions_tenant_idx ON public.recording_sessions(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recording_sessions TO authenticated;
GRANT ALL ON public.recording_sessions TO service_role;

ALTER TABLE public.recording_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select_own_sessions"
  ON public.recording_sessions FOR SELECT
  TO authenticated
  USING (tenant_id = auth.uid());

CREATE POLICY "tenant_insert_own_sessions"
  ON public.recording_sessions FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = auth.uid());

CREATE POLICY "tenant_update_own_sessions"
  ON public.recording_sessions FOR UPDATE
  TO authenticated
  USING (tenant_id = auth.uid())
  WITH CHECK (tenant_id = auth.uid());

CREATE POLICY "tenant_delete_own_sessions"
  ON public.recording_sessions FOR DELETE
  TO authenticated
  USING (tenant_id = auth.uid());

CREATE TRIGGER recording_sessions_touch_updated_at
  BEFORE UPDATE ON public.recording_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.recording_sessions;