UPDATE public.proxies p
SET warmup_next_scheduled_at = now() + (v.ord * interval '20 minutes'),
    warmup_running_at = NULL,
    updated_at = now()
FROM (VALUES
  ('CH'::text, 0),
  ('BR'::text, 1),
  ('CO'::text, 2),
  ('ES'::text, 3)
) AS v(country, ord)
WHERE p.country = v.country
  AND p.is_active = true;
