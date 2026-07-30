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
- **`recorder/`** — Külön konténer az **élő felvétel** funkcióhoz.
  Polloz a Brain `/api/public/worker/record-claim` végpontján; minden
  session-höz indít egy Playwright böngészőt, és a képkockákat / felhasználói
  kattintásokat Supabase Realtime broadcast csatornán cseréli a UI-jal
  (csatorna: `record:<sessionId>`). Részletes szerződés:
  `docs/WORKER_CONTRACT_RECORDING.md`.
- **`Dockerfile`** — Az executor image build receptje.
  A recorder saját Dockerfile-t használ (`recorder/Dockerfile`).

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

## Képpuffer a saját vason (shots)

A futások képernyőképei már nem az adatbázisba mennek, hanem a Hetzner SSD-re,
a `shots` szolgáltatásba. Az adatbázisba csak a kép linkje kerül.

`.env` beállítások:

```
SHOTS_DATA_DIR=/srv/kylo-shots        # hol tárolja a képeket a vason
SHOTS_PORT=8088                       # kívülről ezen a porton érhető el
SHOTS_PUBLIC_URL=https://shots.pelda.hu   # a Brain felület ezt a linket tölti be
SHOTS_RETENTION_DAYS=14               # ennél régebbi képeket automatikusan törli
```

Ha a `SHOTS_PUBLIC_URL` üres, a képek nem lesznek megjeleníthetők a felületen —
állíts be egy nyilvános címet (domain vagy `http://<vps-ip>:8088`).

Ellenőrzés: `curl http://localhost:8088/health`

## Öngyógyítás (stabilitás)

Négy réteg védi a futásokat:

1. **Docker restart: always** — konténer összeomlásnál azonnal újraindul.
2. **Healthcheck + autoheal** — az orchestrator és a recorder saját health portot
   nyit (9090 / 9091). Ha a fő ciklus 2 percig nem pörög (befagyott), a konténer
   `unhealthy` lesz, és az `autoheal` szolgáltatás újraindítja.
3. **Gépszintű watchdog** — ha az egész stack leáll (reboot, docker restart),
   a `watchdog.sh` percenként visszahozza.
4. **Szabályos leállás (drain)** — újraindításkor a worker NEM lövi ki a futó
   munkákat: abbahagyja az újak felvételét, és megvárja a folyamatban lévőket
   (orchestrator: max 45 perc, recorder: max 20 perc). Így egy frissítés nem
   szakítja félbe a Brain 45 perces süti-gyűjtéseit.

### Telepítés a VPS-en (egyszer)

```sh
cd ~/kylo-worker/worker
sudo cp systemd/kylo-worker.service systemd/kylo-watchdog.service systemd/kylo-watchdog.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kylo-worker.service kylo-watchdog.timer
```

Ellenőrzés:

```sh
systemctl status kylo-watchdog.timer
docker compose ps            # minden konténer "healthy"
docker compose exec orchestrator wget -qO- http://127.0.0.1:9090/health
```

### Dinamikus párhuzamossági fék

A `MAX_PARALLEL` a felső korlát, de az orchestrator méri a gép terhelését, és
ha kevés a szabad RAM vagy magas a load, átmenetileg nem vesz fel új munkát
(a logban `[fék] ...` sor jelzi). `.env` hangolás:

```
MAX_PARALLEL=12          # felső korlát (nagy vason 40-60)
MEM_PER_JOB_MB=1200      # ennyi szabad RAM kell egy új munkához
LOAD_PER_CPU_LIMIT=1.5   # load/mag arány, felette fékez
MEM_HARD_LIMIT_PCT=90    # e fölött semmit nem indít
```

---

## Zéró leállású frissítés (blue-green)

Két azonos készlet van: **blue** és **green**. Egyszerre csak az egyik dolgozik.
Frissítéskor a másik épül fel az új kóddal, elindul, és csak ha egészséges,
akkor kapja meg a régi a "szépen fejezd be" jelet (drain): nem vesz fel új
munkát, de a futókat végigcsinálja (max. 45 perc). **Semmi nem szakad félbe.**

### Egyszeri beállítás a VPS-en

```bash
cd ~/kylo-worker && git pull
cd worker
chmod +x deploy.sh deploy-poll.sh watchdog.sh

# a régi (egyszínű) konténerek szabályos leállítása — kivárja a futó munkákat
docker compose stop -t 2700 orchestrator recorder 2>/dev/null || true
docker compose rm -f orchestrator recorder 2>/dev/null || true

# első indítás blue színnel
docker compose build executor-image
docker compose --profile blue build
docker compose --profile blue up -d
echo blue > .active-color
docker compose --profile blue ps
```

### Az egygombos frissítés bekapcsolása (Brain → VPS)

```bash
sudo cp ~/kylo-worker/worker/systemd/kylo-deploy.service /etc/systemd/system/
sudo cp ~/kylo-worker/worker/systemd/kylo-deploy.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kylo-deploy.timer
systemctl list-timers | grep kylo
```

Ezután a Brainben a **Worker terhelés → Frissítés indítása** gomb elég:
a VPS egy percen belül észreveszi, lefuttatja a `deploy.sh`-t, és a naplót
élőben visszaküldi a felületre.

### Kézi frissítés (ha épp terminálban vagy)

```bash
cd ~/kylo-worker/worker && ./deploy.sh
```

### Mi történik pontosan

1. `git pull` a legfrissebb kódra
2. új image-ek építése (a futó készletet ez nem érinti)
3. az inaktív szín indítása, health-várás (max 5 perc)
4. ha nem lesz egészséges → visszalépés, a régi fut tovább
5. ha egészséges → a régi drain + leállítás
6. `.active-color` frissül; a watchdog innentől az új színt őrzi

---

## Esti fejlesztői mód — gyors tesztelés build nélkül

Cél: éjjel/este ne kelljen minden apró szkript-módosítás után percekig várni a
Docker buildre. Ilyenkor az executor konténer a VPS fájlrendszeréről olvassa a
friss szkripteket (read-only becsatolás), tehát egy `git pull` után **azonnal**
az új kód fut.

### Mit csatolunk be

Csak ezt a kettőt:

- `worker/executor/run.js`
- `worker/executor/scripts/`

A `node_modules` és a Playwright böngészők maradnak az image-ből — csomag- vagy
Dockerfile-változáshoz továbbra is teljes (blue-green) frissítés kell. A rendszer
ezt magától felismeri.

### Mikor aktív

| Beállítás | Jelentés |
|---|---|
| `LIVE_MODE=auto` (alap) | csak a `LIVE_WINDOW` idősávban (alap: 17:00–08:00, Európa/Budapest) |
| `LIVE_MODE=on` | mindig |
| `LIVE_MODE=off` | soha (tisztán image-ből) |

Kézi kapcsolás azonnal, újraindítás nélkül:

```bash
cd ~/kylo-worker/worker
./live.sh on       # most azonnal élő szkriptek
./live.sh off      # vissza a beépítettre
./live.sh auto     # idősávos automatika
./live.sh status   # mi van most érvényben
```

### Biztonsági fékek

1. Minden becsatolás **read-only** — a futás nem tudja elrontani a forrást.
2. Indítás előtt `node --check` fut az összes érintett fájlon. Egyetlen hibás
   fájl esetén a live mód kikapcsol, és a futás a bevált image-ből megy.
3. A gyors frissítés (`sync-scripts.sh`) hiba esetén automatikusan visszaáll az
   előző commitra.
4. Minden futás naplójának első sora kiírja, melyik forrásból ment
   (élő szkript vagy image) — utólag is visszakereshető.
5. Nappal alapból image-ből fut minden, tehát az éles tesztek kiszámíthatók.

### Frissítési útvonalak

- **Csak szkript változott + élő mód aktív** → `sync-scripts.sh`: git pull +
  szintaxis-ellenőrzés, néhány másodperc, nincs újraindítás.
- **Bármi más (csomag, orchestrator, recorder, Dockerfile) vagy élő mód ki** →
  a megszokott zéró leállású blue-green `deploy.sh`.

A döntést a `deploy.sh` hozza meg magától; a Brainben lévő „Frissítés" gomb és a
percenkénti automatika ugyanezt használja. Teljes frissítés kikényszerítése:

```bash
DEPLOY_FORCE_FULL=1 ./deploy.sh
```

### Egyszeri teendő a VPS-en

```bash
cd ~/kylo-worker && git pull
cd worker && chmod +x sync-scripts.sh live.sh
./deploy.sh          # ez beírja a .env-be a LIVE_EXECUTOR_HOST_DIR értéket
```
