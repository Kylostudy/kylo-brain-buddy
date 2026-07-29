CREATE TABLE public.worker_deploy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  worker_id text,
  active_color text,
  log text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX worker_deploy_requests_status_idx ON public.worker_deploy_requests (status, created_at);

GRANT SELECT, INSERT ON public.worker_deploy_requests TO authenticated;
GRANT ALL ON public.worker_deploy_requests TO service_role;

ALTER TABLE public.worker_deploy_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view deploy requests"
  ON public.worker_deploy_requests FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can request a deploy"
  ON public.worker_deploy_requests FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid() AND status = 'pending');