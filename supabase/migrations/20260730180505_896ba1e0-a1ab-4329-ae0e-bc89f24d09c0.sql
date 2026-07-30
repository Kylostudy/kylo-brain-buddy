UPDATE public.audit_scenarios
SET record_start_url = 'https://kylo.study/generalas',
    updated_at = now()
WHERE id = 'ea0b4bc9-c500-4bbb-80df-27d62b1262dd'
  AND record_start_url IS DISTINCT FROM 'https://kylo.study/generalas';

UPDATE public.workflows
SET name = CASE
      WHEN id = '8909187e-de02-416e-a374-770183b28bcf' THEN 'Olvasónapló létrehozása — felvételi háttér'
      WHEN id = '73661d9f-bd66-44de-8daf-1804b2eb98bd' THEN 'Belépés — felvételi háttér'
      ELSE name
    END,
    updated_at = now()
WHERE id IN (
  '8909187e-de02-416e-a374-770183b28bcf',
  '73661d9f-bd66-44de-8daf-1804b2eb98bd'
);