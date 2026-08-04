CREATE TABLE public.reddit_post_watches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  workflow_id uuid REFERENCES public.workflows(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.reddit_accounts(id) ON DELETE SET NULL,
  permalink text NOT NULL,
  post_external_id text,
  title text,
  subreddit text,
  language text NOT NULL DEFAULT 'en',
  active boolean NOT NULL DEFAULT true,
  last_scanned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reddit_post_watches TO authenticated;
GRANT ALL ON public.reddit_post_watches TO service_role;

ALTER TABLE public.reddit_post_watches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rpw_select" ON public.reddit_post_watches
  FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "rpw_insert" ON public.reddit_post_watches
  FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "rpw_update" ON public.reddit_post_watches
  FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "rpw_delete" ON public.reddit_post_watches
  FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

CREATE TRIGGER rpw_touch BEFORE UPDATE ON public.reddit_post_watches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_rpw_tenant_active ON public.reddit_post_watches (tenant_id, active);

ALTER TABLE public.reddit_comments
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'inbox',
  ADD COLUMN IF NOT EXISTS watch_id uuid REFERENCES public.reddit_post_watches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS telegram_message_id bigint,
  ADD COLUMN IF NOT EXISTS telegram_chat_id bigint,
  ADD COLUMN IF NOT EXISTS approved_reply_en text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_reddit_comments_tg ON public.reddit_comments (telegram_message_id);