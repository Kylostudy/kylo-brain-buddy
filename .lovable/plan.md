
# Warmup rendszer 12 IP-re

## Döntések összefoglalva

- **12 IP** (10 BrightData + Amsterdam IPRoyal + US IPRoyal), mindegyikhez 1 warmup workflow.
- **Nyelvek per ország:** NL/US/CA/AU/GB → angol · HU → magyar · CH → német · ES/MX → spanyol · SE → svéd · PL → lengyel · BR → portugál (brazil).
- **Gyakoriság:** hetente 1×, véletlen napon, az adott ország időzónájában nappal.
- **Hossz:** 45 perc / IP.
- **Sorrend:** először az angol blokk (NL, US, CA, AU, GB), utána a többi. Nem kell egy éjszaka alatt végezni.
- **Fingerprint tárolás:** a `proxies` táblához új oszlopok (1 IP = 1 fix virtuális ember). Több account is „ráülhet" ugyanarra a fingerprintre.
- **Süti-jar:** IP+fingerprint szinten közös, nem másoljuk IP-k között.

## Lépések

### 1. Adatbázis — `proxies` tábla bővítése (migráció)

Új oszlopok:
- `fingerprint_user_agent` (text) — pl. Chrome 131 Windows
- `fingerprint_locale` (text) — pl. `hu-HU`, `en-US`, `de-CH`
- `fingerprint_timezone` (text) — pl. `Europe/Budapest`
- `fingerprint_viewport_w`, `fingerprint_viewport_h` (int)
- `fingerprint_platform` (text) — `Win32` / `MacIntel`
- `fingerprint_seed` (text) — stabil véletlen mag további jelekhez (WebGL, canvas)
- `warmup_language` (text) — `hu`, `en`, `de`, `es`, `sv`, `pl`, `pt-BR`
- `warmup_country_sites` (text[]) — portál lista (nullable, sablonból default)
- `warmup_last_run_at`, `warmup_next_scheduled_at` (timestamptz)

### 2. Fingerprint feltöltés (adat)

12 proxyhoz egyszeri `UPDATE` — mindegyikhez konzisztens virtuális ember (nyelv + időzóna + reális UA + viewport). Egyszerűen, kézzel megírt sorok, nem generátor.

### 3. Warmup szkript általánosítása (VPS oldal)

`worker/executor/scripts/logged-out-warmup.js` már 90%-ban jó. Módosítások:
- A `spec.language` alapján válasszon **országsablont** (portál lista + Google domain + keresőszavak).
- Új fájl: `worker/executor/scripts/warmup-locales/{en,hu,de,es,sv,pl,pt-BR}.js` — mindegyik exportál `sites` + `queries` + `google_domain` + `cookie_accept_texts`.
- A worker a proxy fingerprintjét a Playwright kontextusra alkalmazza (user-agent, viewport, locale, timezone). Ez a `worker/executor/run.js`-ben történik, ahol a browser context létrejön.

### 4. 12 warmup workflow létrehozása (adat)

Egy admin route: `src/routes/api/public/admin/create-warmup-workflows.ts`
- Végigmegy a 12 proxyn.
- Mindegyikhez létrehoz egy `workflows` sort:
  - `name`: „Warmup — {ország}"
  - `spec_json`: `{ script: "logged-out-warmup", duration_min: 45, language: "..", proxy_id: "..", target_platform: null }`
  - `schedule`: heti 1× (a dispatcher tudja értelmezni)
- Idempotens: ha már van „Warmup —" prefixű workflow az adott proxyhoz, kihagyja.

### 5. Heti ütemező (cron + dispatcher)

Két megközelítés közül a **meglévő dispatcher** kibővítése:
- `src/lib/monitors/dispatch.server.ts` már fut cron alól (`/api/public/cron/dispatch-brain-tasks`).
- Kiegészítés: minden warmup workflow-nál kiszámol egy `warmup_next_scheduled_at`-ot (aktuális hét + random nap + random időpont az ország időzónájában, 9–20 óra között), és amikor lejár, betolja a `brain_task_queue`-ba.
- Egyszerre max 1 warmup fut IP-nként (a proxy amúgy is „foglalt" lesz). Ha ütközne, csúsztat.

### 6. UI (opcionális, most nem építek)

A `_authenticated.proxies.tsx` oldalon később hozzáadhatunk egy kis oszlopot: „Utolsó warmup", „Következő warmup". Most csak DB-szinten megy, később UI-t rakok rá, ha kéred.

## Technikai jegyzet

- Fingerprint konzisztencia: a `proxy_id`-hez tartozó fingerprintet a claim endpoint (`/api/public/worker/claim.ts`) adja át a workernek a task payloadjában, így a VPS worker nem generál semmit véletlenül.
- Cookie-jar mentés: a warmup végén a `workflow_credentials.cookie_ciphertext`-be íródik (már megvan a mechanizmus a `logged-out-warmup.js`-ben), de a kulcs a **proxy_id + language**, nem az account, hogy több account is örökölhesse.
- Heti gyakoriság: a `workflows` táblához nem kell séma-módosítás, a `spec_json`-be teszem be a `warmup_cadence: "weekly"` mezőt, a dispatcher ezt olvassa.

## Amit MOST fogok csinálni

1. Migráció: `proxies` táblához fingerprint + warmup oszlopok.
2. Adatfeltöltés: 12 proxyhoz fingerprint + nyelv beállítása (SQL insert-tool).
3. Nyelvi sablonfájlok (7 db) a workerben.
4. `logged-out-warmup.js` általánosítása a `language` paraméterre.
5. `run.js`-ben fingerprint alkalmazása a browser contextre.
6. Admin route: 12 warmup workflow létrehozása.
7. Dispatcher kibővítése heti ütemezéssel.

Amit **később** csinálok, csak ha kéred: UI a proxies oldalon (utolsó/következő warmup mutatása), manuális „Warmup most" gomb.

Amint jóváhagyod, nekiállok.
