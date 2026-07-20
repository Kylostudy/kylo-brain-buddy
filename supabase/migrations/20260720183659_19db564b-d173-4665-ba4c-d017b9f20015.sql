
-- Reddit Inbox: accounts + comments

CREATE TABLE public.reddit_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  username TEXT,
  locale TEXT NOT NULL DEFAULT 'en-US',
  karma INTEGER,
  account_created_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reddit_accounts TO authenticated;
GRANT ALL ON public.reddit_accounts TO service_role;

ALTER TABLE public.reddit_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant reads own reddit accounts"
  ON public.reddit_accounts FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant inserts own reddit accounts"
  ON public.reddit_accounts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant updates own reddit accounts"
  ON public.reddit_accounts FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant deletes own reddit accounts"
  ON public.reddit_accounts FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE TRIGGER update_reddit_accounts_updated_at
  BEFORE UPDATE ON public.reddit_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.reddit_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.reddit_accounts(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  permalink TEXT NOT NULL,
  subreddit TEXT,
  author TEXT,
  context_title TEXT,
  body_en TEXT NOT NULL,
  body_hu TEXT,
  suggested_reply_hu TEXT,
  suggested_reply_en TEXT,
  reply_status TEXT NOT NULL DEFAULT 'pending',
  posted_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, external_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reddit_comments TO authenticated;
GRANT ALL ON public.reddit_comments TO service_role;

ALTER TABLE public.reddit_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant reads own reddit comments"
  ON public.reddit_comments FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant inserts own reddit comments"
  ON public.reddit_comments FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant updates own reddit comments"
  ON public.reddit_comments FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant deletes own reddit comments"
  ON public.reddit_comments FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE TRIGGER update_reddit_comments_updated_at
  BEFORE UPDATE ON public.reddit_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_reddit_comments_workflow_status
  ON public.reddit_comments (workflow_id, reply_status, collected_at DESC);
