
-- Bővítjük a reddit_accounts táblát warmup mezőkkel
ALTER TABLE public.reddit_accounts
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS proxy_id uuid REFERENCES public.proxies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warmup_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS warmup_days_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warmup_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS subreddits_joined jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS target_subreddits jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz;

-- Napi warmup log
CREATE TABLE IF NOT EXISTS public.reddit_warmup_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.reddit_accounts(id) ON DELETE CASCADE,
  activity_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  scroll_minutes integer NOT NULL DEFAULT 0,
  upvotes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  joined_subreddits jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, activity_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reddit_warmup_log TO authenticated;
GRANT ALL ON public.reddit_warmup_log TO service_role;
ALTER TABLE public.reddit_warmup_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant reads own warmup log" ON public.reddit_warmup_log
  FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "tenant inserts own warmup log" ON public.reddit_warmup_log
  FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "tenant updates own warmup log" ON public.reddit_warmup_log
  FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "tenant deletes own warmup log" ON public.reddit_warmup_log
  FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

CREATE TRIGGER update_reddit_warmup_log_updated_at
  BEFORE UPDATE ON public.reddit_warmup_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS reddit_warmup_log_account_idx ON public.reddit_warmup_log(account_id, activity_date DESC);

-- Story bank
CREATE TABLE IF NOT EXISTS public.reddit_story_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  language text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  notes text,
  used_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reddit_story_bank TO authenticated;
GRANT ALL ON public.reddit_story_bank TO service_role;
ALTER TABLE public.reddit_story_bank ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant reads own story bank" ON public.reddit_story_bank
  FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "tenant inserts own story bank" ON public.reddit_story_bank
  FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "tenant updates own story bank" ON public.reddit_story_bank
  FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "tenant deletes own story bank" ON public.reddit_story_bank
  FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

CREATE TRIGGER update_reddit_story_bank_updated_at
  BEFORE UPDATE ON public.reddit_story_bank
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS reddit_story_bank_lang_idx ON public.reddit_story_bank(tenant_id, language);
