CREATE TABLE public.workflow_credentials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  platform TEXT NOT NULL DEFAULT 'unknown',
  username TEXT NOT NULL DEFAULT '',
  password_ciphertext TEXT,
  password_nonce TEXT,
  cookie_ciphertext TEXT,
  cookie_nonce TEXT,
  totp_secret_ciphertext TEXT,
  totp_nonce TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_credentials TO authenticated, anon;
GRANT ALL ON public.workflow_credentials TO service_role;

ALTER TABLE public.workflow_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY dev_all_workflow_credentials ON public.workflow_credentials FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER trg_workflow_credentials_updated_at
BEFORE UPDATE ON public.workflow_credentials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();