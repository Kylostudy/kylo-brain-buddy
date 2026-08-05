CREATE TABLE public.reddit_discourse_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workflow_id UUID REFERENCES public.workflows(id) ON DELETE CASCADE,
  subreddit TEXT NOT NULL,
  language_label TEXT NOT NULL DEFAULT '',
  snapshot_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  posts_analyzed INTEGER NOT NULL DEFAULT 0,
  comments_analyzed INTEGER NOT NULL DEFAULT 0,
  themes JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary_hu TEXT NOT NULL DEFAULT '',
  tone_hu TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subreddit, snapshot_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reddit_discourse_snapshots TO authenticated;
GRANT ALL ON public.reddit_discourse_snapshots TO service_role;
ALTER TABLE public.reddit_discourse_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read discourse snapshots" ON public.reddit_discourse_snapshots
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant write discourse snapshots" ON public.reddit_discourse_snapshots
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE INDEX idx_discourse_snapshots_tenant_date
  ON public.reddit_discourse_snapshots (tenant_id, snapshot_date DESC, subreddit);

CREATE TABLE public.reddit_discourse_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workflow_id UUID REFERENCES public.workflows(id) ON DELETE CASCADE,
  subreddit TEXT NOT NULL,
  language_label TEXT NOT NULL DEFAULT '',
  based_on_days INTEGER NOT NULL DEFAULT 0,
  headline_hu TEXT NOT NULL DEFAULT '',
  rationale_hu TEXT NOT NULL DEFAULT '',
  entry_type TEXT NOT NULL DEFAULT 'comment',
  best_time_hu TEXT NOT NULL DEFAULT '',
  draft_hu TEXT NOT NULL DEFAULT '',
  target_permalink TEXT,
  confidence INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reddit_discourse_suggestions TO authenticated;
GRANT ALL ON public.reddit_discourse_suggestions TO service_role;
ALTER TABLE public.reddit_discourse_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read discourse suggestions" ON public.reddit_discourse_suggestions
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant write discourse suggestions" ON public.reddit_discourse_suggestions
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE INDEX idx_discourse_suggestions_tenant_created
  ON public.reddit_discourse_suggestions (tenant_id, created_at DESC, confidence DESC);