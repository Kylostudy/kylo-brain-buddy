CREATE TABLE public.telegram_outbox (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id bigint NOT NULL,
  chat_id bigint,
  topic text NOT NULL DEFAULT 'generic',
  platform text,
  ref_table text,
  ref_id text,
  label text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  reply_text text,
  replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX telegram_outbox_message_id_key ON public.telegram_outbox (message_id);
GRANT ALL ON public.telegram_outbox TO service_role;
ALTER TABLE public.telegram_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_read_telegram_outbox" ON public.telegram_outbox FOR SELECT TO authenticated USING (public.is_platform_operator());