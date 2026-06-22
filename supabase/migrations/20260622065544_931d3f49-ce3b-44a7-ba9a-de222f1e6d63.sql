INSERT INTO public.tenant_module_access (tenant_id, module, granted_at)
SELECT 'c13c29af-b546-41e3-a4d5-9b3bb3a71326'::uuid, m, now()
FROM (VALUES ('brain'::app_module), ('audit'::app_module)) AS t(m)
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_module_access
  WHERE tenant_id = 'c13c29af-b546-41e3-a4d5-9b3bb3a71326'::uuid AND module = t.m
);