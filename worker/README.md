# KyloKit Worker — saját VPS, Docker + Playwright

Ez a komponens a **saját szervereden** fut (95.216.224.103). Itt indulnak el
a Playwright virtuális böngészők, amik az időzített / kézzel indított
workflow-kat végrehajtják.

A KyloBrain (a felület + a hozzá tartozó backend) **Lovable Cloud-on marad**,
ide csak a worker kerül. A két oldal egy publikus, megosztott tokennel
védett HTTP API-n keresztül beszélget — a workernek nem kell se Supabase
service-role kulcs, se DB hozzáférés.

## Architektúra

```text
KyloBrain (Lovable Cloud)              KyloKit worker (saját VPS)
┌───────────────────────────┐          ┌──────────────────────────────────┐
│  Felület + Backend        │  HTTPS   │  worker-orchestrator (Node)      │
│                           │ ◀──────▶ │   - POST /api/public/worker/     │
│  POST /api/public/worker/ │  Bearer  │       claim       (új job?)      │
│    claim      complete    │  token   │       complete    (eredmény)     │
│                           │          │   - docker run executor          │
│  workflow_runs (DB)       │          │                                  │
└───────────────────────────┘          │  executor image: Playwright +    │
                                       │  Chromium, egy futás = 1 konténer │
                                       └──────────────────────────────────┘
```

## Komponensek

- **`orchestrator/`** — Node folyamat, ami a Brain publikus job-API-ját
  pollozza, és minden visszakapott jobra egy Docker konténert indít. A
  konténer stdout JSON-line logjait visszaküldi a Brainnek a `complete`
  végponton.
- **`executor/`** — A konténer belseje. Node + Playwright image, ami a
  `SPEC_JSON` env alapján dispatchel:
  - `monitor_type: "decathlon-stock"` → `scripts/decathlon-stock.js`
  - `platform: "tiktok"` → `scripts/tiktok.js`
- **`Dockerfile`** — Az executor image build receptje.

## VPS telepítés (egyszeri)

```sh
# 1) Csatlakozás (felhasználói gépedről)
ssh kylo@95.216.224.103

# 2) Docker telepítése, ha még nincs (kylo legyen a docker csoportban)
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker kylo
newgrp docker

# 3) Kódot másold fel (a saját gépedről)
scp -r worker/ kylo@95.216.224.103:/home/kylo/kylokit

# 4) .env létrehozása (a szerveren)
cd /home/kylo/kylokit
cp .env.example .env
nano .env   # töltsd ki: BRAIN_URL, WORKER_API_TOKEN

# 5) Indítás
docker compose up -d --build

# 6) Logok ellenőrzése
docker compose logs -f orchestrator
```

Egy egészséges futtatáskor 3 másodpercenként lát egy claim-próbálkozást a
logban; ha a Brainen van queued job, akkor egy `[run <uuid>] start` →
`[run <uuid>] succeeded|failed` sorpárt.

## Frissítés

```sh
cd /home/kylo/kylokit
git pull            # vagy újabb scp
docker compose up -d --build
```
