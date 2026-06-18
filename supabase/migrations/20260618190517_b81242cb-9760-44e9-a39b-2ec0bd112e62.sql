ALTER TABLE public.workflow_credentials
  ADD COLUMN IF NOT EXISTS proxy_ciphertext text,
  ADD COLUMN IF NOT EXISTS proxy_nonce text;