# Workflow Teszt futtatás + whoer.net preflight

## Cél

A workflow oldalon egy **Teszt futtatás** gomb elindítja a teljes flow-t
a finn VPS-en. A flow legelső lépése kötelezően a **whoer.net preflight**:
a böngésző a kijelölt proxyn keresztül megnyitja a whoer.net-et, kiolvassa
a valódi kimenő IP-t, az országot és a várost, és összeveti azzal, amit a
proxynál elvárunk. Ha nem stimmel, a run azonnal `failed` státusszal
leáll, és a TikTok / Pinterest **meg sem nyílik**.

## Felhasználói folyamat

1. Workflow oldalon a Spec panelben proxy kiválasztva (pl. Amsterdam ISP).
2. "Teszt futtatás" gomb megnyomva.
3. Rendszer létrehoz egy runt `queued` státusszal, a finn VPS elkapja.
4. Böngésző elindul a proxyval, megnyitja a `https://whoer.net/`-et.
5. Kiolvassa az IP-t, országot, várost, gateway országot.
6. Összeveti a proxy `country` mezőjével (pl. `NL`).
7. **Eltérés esetén**: run `failed`, hibaüzenet a UI-ban ("Elvárt NL, kapott FI"),
   böngésző bezárul, semmi más nem történik.
8. **Egyezés esetén**: preflight `ok`, a workflow folytatódik a cookie-k
   betöltésével és a felvett lépések lejátszásával.
9. Az UI mutatja a preflight eredményt (whoer screenshot + IP/ország/város).

## Mit építek

### 1. Adatbázis migráció
- `workflow_runs` tábla (ha még nincs playback runs tábla): `id, workflow_id,
  tenant_id, status, proxy_id, preflight_result jsonb, error text,
  created_at, started_at, completed_at`.
- Ha van már megfelelő tábla (`audit_workflow_runs` / `brain_workflow_runs`),
  azt bővítem a `preflight_result` és `proxy_id` mezőkkel.
- RLS + GRANT a tenant-hez.

### 2. Server function: `startWorkflowRun`
- `src/lib/runs.functions.ts` (vagy új `test-run.functions.ts`).
- `requireSupabaseAuth` middleware.
- Létrehoz egy `queued` runt a workflow-hoz, kiválasztott proxy-val.
- Visszaadja a run ID-t.

### 3. UI: "Teszt futtatás" gomb
- `src/routes/_authenticated.w.$workflowId.tsx` vagy `spec-panel.tsx`.
- Egy nagy Play gomb a proxy választó alatt.
- Csak akkor aktív, ha van proxy hozzárendelve.
- Kattintás után: toast + real-time státusz frissítés (queued → preflight → running → done/failed).
- Preflight eredmény doboz: IP, ország, város, screenshot thumbnail.

### 4. Worker executor bővítés
- A recorder helyett a `worker/executor/run.js` (playback) kap preflight fázist.
- Új függvény `whoerPreflight(page, expectedCountry)`:
  - `page.goto('https://whoer.net/', { waitUntil: 'networkidle' })`
  - Kiolvassa a DOM-ból: IP (`.your-ip .num`), Country (`.your-country .value`),
    City, Gateway country.
  - Screenshot mentése.
  - Ha `country !== expectedCountry` → dob egy `PreflightMismatchError`-t.
- A worker a preflight eredményt (JSON + screenshot base64) visszaküldi a
  Brain-nek a `record-status` / új `run-status` endpoint-on.
- Csak sikeres preflight után folytatódik a cookie load + recorded actions.

### 5. Új public endpoint
- `POST /api/public/worker/run-claim` — playback runt igényel.
- `POST /api/public/worker/run-status` — státusz + preflight eredmény
  frissítése.
- Ugyanaz a `WORKER_API_TOKEN` bearer auth, mint a recorder-nél.

## Technikai részletek

- **whoer.net parsing**: az oldal HTML-ből kiszedhető szelektorokkal; ha a
  weboldal változik, a script tolerálja (fallback: page.content() regex).
- **Timeout**: preflight max 30 mp; ezután automatikus fail.
- **Nincs 3rd-party API kulcs** — whoer publikus weboldal, ingyenes.
- **Cookie hardening**: `--disable-blink-features=AutomationControlled` +
  stealth plugin már megvan a workerben.

## Mit NEM építek most

- Nem cserélem le a meglévő recorder flow-t.
- Nem indítok éles TikTok/Pinterest feltöltést — csak a preflight + a
  felvett lépések replay-e.
- Nem építek külön "Teszt proxy" gombot a Proxy oldalra (nem kell).
- Kylogic időzítés-integráció külön lépés, később.

## Elfogadási kritérium

- Workflow oldalon látszik a Teszt gomb.
- Nyomásra 5–15 mp-en belül megjelenik a whoer.net screenshot + IP-adatok.
- Ha az amszterdami ISP proxy jól van beállítva → preflight `ok` (NL).
- Ha véletlenül nincs proxy vagy rossz proxy → preflight `failed` látható
  hibaüzenettel, és a workflow lépések **nem** futnak le.
