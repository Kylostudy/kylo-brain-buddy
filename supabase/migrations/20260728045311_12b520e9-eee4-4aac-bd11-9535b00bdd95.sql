-- 1) Régi warmup credential sorok proxy-kapcsolatának visszatöltése a workflow spec alapján.
UPDATE public.workflow_credentials wc
SET proxy_id = (w.spec->>'proxy_id')::uuid,
    updated_at = now()
FROM public.workflows w
WHERE wc.workflow_id = w.id
  AND w.module = 'brain'
  AND w.spec->>'is_warmup' = 'true'
  AND w.spec->>'proxy_id' IS NOT NULL
  AND wc.proxy_id IS NULL;

-- 2) Meglévő warmup süticsomag átmásolása az ugyanarra a proxyra kötött többi workflow credential sorba.
WITH warmup_cookies AS (
  SELECT
    wc.proxy_id,
    wc.cookie_ciphertext,
    wc.cookie_nonce,
    w.tenant_id,
    w.cookie_jar_country,
    w.cookie_jar_stats
  FROM public.workflow_credentials wc
  JOIN public.workflows w ON w.id = wc.workflow_id
  WHERE w.module = 'brain'
    AND w.spec->>'is_warmup' = 'true'
    AND wc.proxy_id IS NOT NULL
    AND wc.cookie_ciphertext IS NOT NULL
    AND wc.cookie_nonce IS NOT NULL
), target_creds AS (
  UPDATE public.workflow_credentials target
  SET cookie_ciphertext = source.cookie_ciphertext,
      cookie_nonce = source.cookie_nonce,
      updated_at = now()
  FROM warmup_cookies source, public.workflows tw
  WHERE target.proxy_id = source.proxy_id
    AND tw.id = target.workflow_id
    AND tw.module = 'brain'
    AND COALESCE(tw.spec->>'is_warmup', 'false') <> 'true'
    AND target.cookie_ciphertext IS NULL
  RETURNING target.workflow_id, source.cookie_jar_country, source.cookie_jar_stats
)
UPDATE public.workflows w
SET cookie_jar_country = COALESCE(target_creds.cookie_jar_country, w.cookie_jar_country),
    cookie_jar_updated_at = now(),
    cookie_jar_stats = COALESCE(target_creds.cookie_jar_stats, w.cookie_jar_stats),
    updated_at = now()
FROM target_creds
WHERE w.id = target_creds.workflow_id;

-- 3) Ha ugyanarra a proxyra nincs cél credential sor, de van cél workflow, hozzuk létre a sort a warmup sütivel.
WITH warmup_cookies AS (
  SELECT DISTINCT ON (wc.proxy_id)
    wc.proxy_id,
    wc.cookie_ciphertext,
    wc.cookie_nonce,
    w.tenant_id,
    w.cookie_jar_country,
    w.cookie_jar_stats
  FROM public.workflow_credentials wc
  JOIN public.workflows w ON w.id = wc.workflow_id
  WHERE w.module = 'brain'
    AND w.spec->>'is_warmup' = 'true'
    AND wc.proxy_id IS NOT NULL
    AND wc.cookie_ciphertext IS NOT NULL
    AND wc.cookie_nonce IS NOT NULL
  ORDER BY wc.proxy_id, wc.updated_at DESC NULLS LAST
), targets AS (
  SELECT
    tw.id AS workflow_id,
    tw.tenant_id,
    wc.proxy_id,
    wc.cookie_ciphertext,
    wc.cookie_nonce,
    wc.cookie_jar_country,
    wc.cookie_jar_stats
  FROM public.workflows tw
  JOIN public.workflow_credentials tc ON tc.workflow_id = tw.id
  JOIN warmup_cookies wc ON wc.proxy_id = tc.proxy_id
  WHERE tw.module = 'brain'
    AND COALESCE(tw.spec->>'is_warmup', 'false') <> 'true'
    AND NOT EXISTS (
      SELECT 1
      FROM public.workflow_credentials existing
      WHERE existing.workflow_id = tw.id
        AND existing.cookie_ciphertext IS NOT NULL
    )
)
INSERT INTO public.workflow_credentials (
  workflow_id,
  tenant_id,
  platform,
  username,
  proxy_id,
  cookie_ciphertext,
  cookie_nonce
)
SELECT
  workflow_id,
  tenant_id,
  'warmup',
  'warmup-jar',
  proxy_id,
  cookie_ciphertext,
  cookie_nonce
FROM targets
WHERE NOT EXISTS (
  SELECT 1
  FROM public.workflow_credentials existing
  WHERE existing.workflow_id = targets.workflow_id
);

-- 4) A legfontosabb hiányzó Reddit/warmup országok újra sorba állítása, hogy ne maradjanak next_scheduled=NULL állapotban.
WITH prioritized AS (
  SELECT
    p.id,
    row_number() OVER (
      ORDER BY CASE
        WHEN lower(w.language) = 'de' OR p.country IN ('CH','DE') THEN 1
        WHEN lower(w.language) IN ('pt','pt-br') OR p.country IN ('BR','PT') THEN 2
        WHEN lower(w.language) = 'es' OR p.country IN ('ES','CO','MX') THEN 3
        WHEN lower(w.language) = 'ar' OR p.country IN ('SA','AE','EG','MA') THEN 4
        ELSE 9
      END,
      p.country
    ) AS rn
  FROM public.proxies p
  JOIN public.workflows w ON w.tenant_id = p.tenant_id
    AND w.module = 'brain'
    AND w.active = true
    AND w.spec @> jsonb_build_object('is_warmup', true, 'proxy_id', p.id::text)
  WHERE p.is_active = true
    AND p.warmup_running_at IS NULL
    AND (
      w.cookie_jar_updated_at IS NULL
      OR p.warmup_next_scheduled_at IS NULL
    )
    AND (
      lower(w.language) IN ('de','pt','pt-br','es','ar')
      OR p.country IN ('CH','DE','BR','PT','ES','CO','MX','SA','AE','EG','MA')
    )
)
UPDATE public.proxies p
SET warmup_next_scheduled_at = now() + ((prioritized.rn - 1) * interval '20 minutes'),
    warmup_running_at = NULL,
    updated_at = now()
FROM prioritized
WHERE p.id = prioritized.id;
