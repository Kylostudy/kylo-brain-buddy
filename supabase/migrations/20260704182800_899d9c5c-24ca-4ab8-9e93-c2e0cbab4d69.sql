CREATE TABLE public.worker_learned_selectors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT NOT NULL,
  page_type TEXT NOT NULL,
  field TEXT NOT NULL,
  selector TEXT NOT NULL,
  learned_from TEXT NOT NULL DEFAULT 'gemini_vision',
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_verified_at TIMESTAMP WITH TIME ZONE,
  last_failed_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT worker_learned_selectors_unique UNIQUE (platform, page_type, field)
);

GRANT SELECT ON public.worker_learned_selectors TO authenticated;
GRANT ALL ON public.worker_learned_selectors TO service_role;

ALTER TABLE public.worker_learned_selectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view learned selectors"
  ON public.worker_learned_selectors
  FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER update_worker_learned_selectors_updated_at
  BEFORE UPDATE ON public.worker_learned_selectors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_worker_learned_selectors_lookup
  ON public.worker_learned_selectors (platform, page_type, field);