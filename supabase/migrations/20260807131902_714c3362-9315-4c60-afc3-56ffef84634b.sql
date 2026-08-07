CREATE TABLE public.linkedin_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workflow_id uuid REFERENCES public.workflows(id) ON DELETE SET NULL,
  external_id text NOT NULL,
  source text NOT NULL DEFAULT 'notification',
  kind text NOT NULL DEFAULT 'comment',
  author text,
  author_headline text,
  context_title text,
  permalink text,
  body_en text NOT NULL DEFAULT '',
  body_hu text,
  suggested_reply_hu text,
  suggested_reply_en text,
  needs_reply boolean NOT NULL DEFAULT true,
  reply_status text NOT NULL DEFAULT 'pending',
  approved_reply_hu text,
  approved_reply_en text,
  approved_at timestamptz,
  telegram_message_id bigint,
  telegram_chat_id bigint,
  posted_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX linkedin_comments_tenant_external_idx
  ON public.linkedin_comments (tenant_id, external_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.linkedin_comments TO authenticated;
GRANT ALL ON public.linkedin_comments TO service_role;

ALTER TABLE public.linkedin_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "linkedin_comments_select" ON public.linkedin_comments
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "linkedin_comments_insert" ON public.linkedin_comments
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "linkedin_comments_update" ON public.linkedin_comments
  FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "linkedin_comments_delete" ON public.linkedin_comments
  FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE TRIGGER trg_linkedin_comments_updated_at
  BEFORE UPDATE ON public.linkedin_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();