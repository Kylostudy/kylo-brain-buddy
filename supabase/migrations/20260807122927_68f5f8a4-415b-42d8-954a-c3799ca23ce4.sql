ALTER TABLE public.lead_alerts
  ADD COLUMN IF NOT EXISTS title_hu text,
  ADD COLUMN IF NOT EXISTS excerpt_hu text,
  ADD COLUMN IF NOT EXISTS suggested_reply_hu text,
  ADD COLUMN IF NOT EXISTS approved_reply_hu text,
  ADD COLUMN IF NOT EXISTS approved_reply_en text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;