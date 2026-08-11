UPDATE public.reddit_accounts a
SET quarantined_until = now() + interval '14 days',
    quarantine_reason = 'Reddit automatizmus-figyelmeztetés + törölt kommentek — kézi verifikáció szükséges'
FROM public.workflows w
WHERE w.id = a.workflow_id AND w.name = 'Red Ausztrália K';