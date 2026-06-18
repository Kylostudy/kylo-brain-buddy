# Kylo Worker — saját vas, Docker-alapú futtató

Ez a könyvtár a **jövőbeli** runner backendet tartalmazza, amit egy bérelt
Linux szerveren (pl. Hetzner CX22, ~5 €/hó) fogsz futtatni, és ez váltja ki a
Steel.dev-et, amint van pár stabil workflow.

A frontend / Brain **nem fog változni**, amikor erre váltunk — ugyanaz a
`Runner` interface (`src/lib/runners/types.ts`), csak a `runs.functions.ts`-ben
átírjuk, hogy ne a `steelRunner`-t hívja, hanem queue-zza ide.

## Architektúra dióhéjban

```
Lovable app (Cloudflare)            Bérelt VPS (Docker host)
┌──────────────────────────┐        ┌─────────────────────────────────────┐
│ Brain UI                 │        │  worker-orchestrator (Node)         │
│   ↓                      │  poll  │    - Supabase-ből húzza a queued    │
│ startRun() server fn     │ ─────▶ │      workflow_runs sorokat          │
│   ↓                      │        │    - spawn Docker container/run     │
│ workflow_runs (Supabase) │ ◀───── │    - logokat + státuszt visszaír    │
└──────────────────────────┘  upd   │                                     │
                                    │  per-workflow Docker image:         │
                                    │    playwright + spec executor       │
                                    └─────────────────────────────────────┘
```

## Komponensek

- **`orchestrator/`** — Node folyamat, ami Supabase-t pollozza, és minden
  `queued` futtatáshoz egy Docker konténert indít. Frissíti a `workflow_runs`
  sort státusszal + logokkal. Itt dekriptáljuk a `workflow_credentials`-t
  (`crypto.js` — ugyanaz a HKDF + AES-256-GCM, mint a Lovable-oldalon), és
  `CREDENTIALS_JSON` env-ben adjuk át a konténernek.
- **`executor/`** — A konténer belseje. Egy Node + Playwright image, ami
  bemenetként megkapja a `spec_snapshot` JSON-t és a visszafejtett creds-et,
  majd platform szerint dispatchel (most: **TikTok**).
- **`executor/scripts/tiktok.js`** — Login (cookie vagy user+pass) +
  videófeltöltés a TikTok Studio-ra. Médiaforrás: URL (letöltés tempbe) vagy
  konténerbe mountolt útvonal.
- **`Dockerfile`** — Az executor image build receptje.

## Credential lánc

```
workflow_credentials (titkosított, Supabase)
     ↓  (SUPABASE_SERVICE_ROLE_KEY a workeren)
orchestrator/crypto.js  → decryptString()
     ↓  CREDENTIALS_JSON env
executor/run.js → runTikTok({ creds, ... })
```

A jelszó és TOTP-titok soha nem kerül logba, és csak a konténer élettartamára
él az env-ben.


## Hosting javaslat (~150 USD/hó helyett)

- **Hetzner CX22** (2 vCPU, 4 GB RAM): ~5 €/hó — kezdésnek bőven elég
  ~10-20 párhuzamos sessionhöz.
- **Hetzner CCX13** (2 dedikált vCPU, 8 GB RAM): ~13 €/hó — ha kell a stabil
  CPU.
- Egy Docker host, `docker compose up -d`, és kész.

## Indítási sorrend (későbbi fázis)

1. Béreld a VPS-t, telepítsd a Docker-t.
2. Másold ide ezt a könyvtárat (`scp -r worker/ root@host:/opt/kylo-worker`).
3. `.env`-be: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_ID`.
4. `docker compose up -d --build`.
5. A Lovable oldalon a `runs.functions.ts`-ben válts át: `runner: "docker"`
   default, és csak hagyd a sort `queued` státuszban — a worker felveszi.

> Most még nem aktív. Először a Steel.dev éles bekötése jön (`STEEL_API_KEY`
> hozzáadása), aztán pár sikeres futtatás után váltunk át erre.
