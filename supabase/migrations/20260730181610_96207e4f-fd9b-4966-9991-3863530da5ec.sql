update public.workflows
set language = coalesce(language, 'hu'),
    region = coalesce(region, 'HU'),
    timezone = coalesce(timezone, 'Europe/Budapest')
where module = 'audit';