ALTER TABLE public.recording_sessions
  ADD COLUMN IF NOT EXISTS prelude_scenario_id uuid REFERENCES public.audit_scenarios(id) ON DELETE SET NULL;