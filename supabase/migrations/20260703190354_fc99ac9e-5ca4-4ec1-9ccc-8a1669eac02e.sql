
ALTER TABLE public.workflow_credentials
  ADD COLUMN IF NOT EXISTS gmail_email text,
  ADD COLUMN IF NOT EXISTS gmail_refresh_ciphertext text,
  ADD COLUMN IF NOT EXISTS gmail_refresh_nonce text,
  ADD COLUMN IF NOT EXISTS gmail_connected_at timestamptz;
