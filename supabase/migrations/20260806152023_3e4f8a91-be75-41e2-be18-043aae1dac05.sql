CREATE TABLE public.lead_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'reddit',
  subreddit text,
  post_id text NOT NULL,
  permalink text NOT NULL,
  title text,
  author text,
  excerpt text,
  score integer NOT NULL DEFAULT 0,
  reason_hu text,
  suggested_reply_en text,
  status text NOT NULL DEFAULT 'new',
  telegram_message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source, post_id)
);
CREATE INDEX idx_lead_alerts_created ON public.lead_alerts (tenant_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_alerts TO authenticated;
GRANT ALL ON public.lead_alerts TO service_role;
ALTER TABLE public.lead_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lead_alerts_select" ON public.lead_alerts FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "lead_alerts_insert" ON public.lead_alerts FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "lead_alerts_update" ON public.lead_alerts FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "lead_alerts_delete" ON public.lead_alerts FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE TABLE public.linkedin_post_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workflow_id uuid REFERENCES public.workflows(id) ON DELETE SET NULL,
  post_url text,
  impressions integer,
  reactions integer,
  comments integer,
  reposts integer,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_linkedin_metrics_captured ON public.linkedin_post_metrics (tenant_id, captured_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.linkedin_post_metrics TO authenticated;
GRANT ALL ON public.linkedin_post_metrics TO service_role;
ALTER TABLE public.linkedin_post_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linkedin_metrics_select" ON public.linkedin_post_metrics FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "linkedin_metrics_insert" ON public.linkedin_post_metrics FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "linkedin_metrics_update" ON public.linkedin_post_metrics FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "linkedin_metrics_delete" ON public.linkedin_post_metrics FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());