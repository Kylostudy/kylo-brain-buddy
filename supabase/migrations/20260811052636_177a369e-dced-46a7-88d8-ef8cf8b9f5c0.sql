ALTER TABLE public.reddit_accounts
  ADD COLUMN IF NOT EXISTS quarantined_until timestamptz,
  ADD COLUMN IF NOT EXISTS quarantine_reason text;