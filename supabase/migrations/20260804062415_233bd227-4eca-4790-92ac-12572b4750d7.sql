CREATE TABLE public.content_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'reddit_post',
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  target_workflow_id uuid REFERENCES public.workflows(id) ON DELETE SET NULL,
  target_ref text,
  status text NOT NULL DEFAULT 'draft',
  last_run_id uuid,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_drafts TO authenticated;
GRANT ALL ON public.content_drafts TO service_role;

ALTER TABLE public.content_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_drafts_select" ON public.content_drafts
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "content_drafts_insert" ON public.content_drafts
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "content_drafts_update" ON public.content_drafts
  FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "content_drafts_delete" ON public.content_drafts
  FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE INDEX idx_content_drafts_tenant ON public.content_drafts(tenant_id, created_at DESC);

CREATE TRIGGER trg_content_drafts_updated_at
  BEFORE UPDATE ON public.content_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();