
CREATE TABLE public.reddit_readonly_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  language_label TEXT NOT NULL DEFAULT '',
  subreddits TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  positioning TEXT NOT NULL DEFAULT '',
  last_scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reddit_readonly_watches TO authenticated;
GRANT ALL ON public.reddit_readonly_watches TO service_role;
ALTER TABLE public.reddit_readonly_watches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read watches" ON public.reddit_readonly_watches
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant write watches" ON public.reddit_readonly_watches
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TRIGGER trg_reddit_readonly_watches_updated
  BEFORE UPDATE ON public.reddit_readonly_watches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.reddit_readonly_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  watch_id UUID REFERENCES public.reddit_readonly_watches(id) ON DELETE SET NULL,
  subreddit TEXT NOT NULL,
  post_id TEXT NOT NULL,
  permalink TEXT NOT NULL,
  title TEXT,
  author TEXT,
  body_excerpt TEXT,
  post_created_at TIMESTAMPTZ,
  relevance INTEGER NOT NULL DEFAULT 0,
  angle_hu TEXT,
  suggested_reply_hu TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, post_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reddit_readonly_findings TO authenticated;
GRANT ALL ON public.reddit_readonly_findings TO service_role;
ALTER TABLE public.reddit_readonly_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read findings" ON public.reddit_readonly_findings
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant write findings" ON public.reddit_readonly_findings
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE INDEX idx_readonly_findings_workflow_relevance
  ON public.reddit_readonly_findings (workflow_id, relevance DESC, collected_at DESC);
