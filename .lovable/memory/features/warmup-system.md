---
name: warmup-system
description: 12 IP heti bemelegítő rendszer — 1 IP = 1 virtuális ember (fingerprint), országonként saját nyelv és portál lista
type: feature
---

## Architektúra

**1 IP = 1 virtuális ember**: minden proxy (`public.proxies`) sorhoz FIX fingerprint tartozik (user_agent, viewport, locale, timezone, platform, seed). A claim endpoint (`src/routes/api/public/worker/claim.ts`) ezt olvassa, és ha megvan, azt adja át a workernek — függetlenül attól, hogy melyik workflow fut az adott IP-n. Több account is „ráülhet" ugyanarra a virtuális emberre.

**12 warmup workflow** — egy per proxy, `spec.is_warmup=true`, `spec.proxy_id=<uuid>`, `spec.language=<lang>`, `spec.duration_min=45`, `spec.monitor_type=logged-out-warmup`.

## Nyelvi hozzárendelés

- NL, US, CA, AU, GB → **en**
- HU → **hu**, CH → **de**, ES + MX → **es**, SE → **sv**, PL → **pl**, BR → **pt-BR**

Nyelvi sablonok: `worker/executor/scripts/warmup-locales/{en,hu,de,es,sv,pl,pt-BR}.js` — mindegyik exportál `{ sites, queries, googleDomain, cookieAcceptTexts }`.

## Ütemezés

- **Heti 1×**, IP-nként **45 perc**.
- pg_cron `schedule-warmups` óránként hívja `/api/public/cron/schedule-warmups`.
- Egy tickben max **3** warmup indul (nem terheli a workert).
- Következő futás: warmup_completion-kor `now + 6-8 nap random`, warmup_next_scheduled_at oszlopba írva.
- `warmup_running_at` timeout: 2 óra (elakadás elleni védelem).
- **Prioritás**: első körben angol blokk (NL → USA → CA → AU → GB), majd többi.

## Sütitár (cookie jar)

- Warmup után a `worker/complete` a `cookies_export`-ot titkosítva menti `workflow_credentials.cookie_ciphertext`-be, workflow-nként.
- **Nem** másoljuk IP-k között — az idegenek sütije más IP-n gyanús lenne.
- **Ugyanazon IP-n** viszont az összes account ugyanabból a warmup jar-ból indulhat.

## Feketelista (soha)

`worker/executor/scripts/logged-out-warmup.js` HARD_BLACKLIST: `linkedin.com, instagram.com, tiktok.com, pinterest.com, facebook.com, x.com, threads.net`. Warmup közben ide semmi körülmények között nem lép.

## Admin route

`POST /api/public/admin/create-warmup-workflows` (header: `x-admin-token: <WORKER_API_TOKEN>`) — új proxyk hozzáadásakor idempotensen létrehozza a hiányzó workflow-kat.
