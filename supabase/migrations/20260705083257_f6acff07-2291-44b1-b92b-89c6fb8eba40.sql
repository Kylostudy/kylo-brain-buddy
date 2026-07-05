
UPDATE public.workflows
SET spec = COALESCE(spec, '{}'::jsonb) || jsonb_build_object(
  'monitor_type', 'logged-out-warmup',
  'target_platform', 'linkedin',
  'duration_min', 45,
  'account_label', 'NL warmup (nincs bejelentkezés)',
  'human_behavior', 'Poisson időzítés, kurzor overshoot, alkalmi misclick, holland tartalom',
  'success_criteria', '30+ süti gyűjtése legalább 5 domain-ről, feketelistás host nélkül'
)
WHERE id = '10c4288f-3c00-42cd-8bb8-ef034ceb86a0';

UPDATE public.workflows
SET spec = COALESCE(spec, '{}'::jsonb) || jsonb_build_object(
  'monitor_type', 'logged-out-warmup',
  'target_platform', 'instagram',
  'duration_min', 45,
  'account_label', 'NL warmup (nincs bejelentkezés)',
  'human_behavior', 'Poisson időzítés, kurzor overshoot, alkalmi misclick, holland tartalom',
  'success_criteria', '30+ süti gyűjtése legalább 5 domain-ről, feketelistás host nélkül'
)
WHERE id = 'db21668d-5570-477e-9cbb-e3769576ddb3';

UPDATE public.workflows
SET spec = COALESCE(spec, '{}'::jsonb) || jsonb_build_object(
  'monitor_type', 'logged-out-warmup',
  'target_platform', 'pinterest',
  'duration_min', 45,
  'account_label', 'NL warmup (nincs bejelentkezés)',
  'human_behavior', 'Poisson időzítés, kurzor overshoot, alkalmi misclick, holland tartalom',
  'success_criteria', '30+ süti gyűjtése legalább 5 domain-ről, feketelistás host nélkül'
)
WHERE id = '85317450-f603-4ada-8deb-48a81cf234ee';

UPDATE public.workflows
SET spec = COALESCE(spec, '{}'::jsonb) || jsonb_build_object(
  'monitor_type', 'logged-out-warmup',
  'target_platform', 'tiktok',
  'duration_min', 45,
  'account_label', 'NL warmup (nincs bejelentkezés)',
  'human_behavior', 'Poisson időzítés, kurzor overshoot, alkalmi misclick, holland tartalom',
  'success_criteria', '30+ süti gyűjtése legalább 5 domain-ről, feketelistás host nélkül'
)
WHERE id = '77f0e215-5a13-42f6-ad27-96d8e2ae5692';
