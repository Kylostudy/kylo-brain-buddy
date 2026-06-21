# Terv: Saját VPS Playwright workerek + első Decathlon-figyelő workflow

## 1. Mit takarítunk el

- **Steel.dev**: a kódban minden hivatkozást/függőséget kivezetünk (`src/lib/runners/steel.server.ts`, `runs.functions.ts` „steel" ága, worker `runner: "steel"` ág, README említései). A connector a Lovable beállításaiban maradhat, ezt nem te kötöd ki manuálisan, csak a kód nem fog ráhivatkozni.

## 2. Architektúra tisztázása — fontos!

Te ezt írtad: „Kylo kitnek a dockert, a Kylo brainnek a dockert". A jelenlegi felépítés miatt **a KyloBrain (a felület + a hozzá tartozó backend) nem kerül a te szerveredre** — az Lovable Cloud‑on fut (Cloudflare). A te VPS‑edre **csak a KyloKit worker** kerül, ami a virtuális böngészőket futtatja. Így néz ki:

```text
Felhasználó böngészője
        │
        ▼
KyloBrain (Lovable Cloud)         ← itt marad, ezt nem mozgatjuk
   - UI, workflow definíciók
   - jobok sorba állítása (workflow_runs tábla)
   - publikus job‑API a workernek
        │  HTTPS (megosztott titok)
        ▼
KyloKit worker (a Te VPS-ed, 95.216.224.103)
   - orchestrator konténer: polloz, indít, jelent
   - executor konténer: Playwright + Chromium, egy futás = egy konténer
```

Ha tényleg külön KyloBrain‑docker kell a saját vasadon (pl. mert mindent ki akarsz költöztetni Lovable‑ből), azt egy későbbi, külön fázisban érdemes — most maradjunk a workernél, ahogy eddig is volt a terv.

## 3. Hiányzó láncszem: hogyan szól a worker a backendhez

Eddig a worker közvetlenül a Supabase service‑role kulccsal akart írni‑olvasni. Lovable Cloud‑on ezt a kulcsot nem tudjuk a te kezedbe adni. Megoldás: **publikus job‑API a Brain oldalán**, megosztott titokkal (`WORKER_API_TOKEN`):

- `GET  /api/public/worker/claim` — a worker elkér egy következő futtatható jobot
- `POST /api/public/worker/heartbeat` — futás közbeni státusz/logok
- `POST /api/public/worker/complete` — végeredmény (succeeded / failed + result)

Mindhárom végpont a kéréshez kötött `Authorization: Bearer <WORKER_API_TOKEN>` fejlécet ellenőrzi (timing‑safe), és csak ezután nyúl a DB‑hez. Ez teljesen kiváltja a service‑role kulcs igényét a workeren.

## 4. Decathlon 4XL fitness póló figyelő (első éles workflow)

- Új workflow‑típus: **„monitor"** — időzítve fut (pl. 15 percenként), nem egyszer.
- Lovable Cloud‑oldalon egy cron (pg_cron vagy a Brain‑ben időzítő) berakja a workflow_runs sort, a worker pedig lefuttatja Playwrighttal.
- Az executor új szkriptje: `executor/scripts/decathlon-stock.js`
  - Megnyitja a megadott termékoldalt
  - Megnézi, a 4XL méret kiválasztható‑e (nincs „nincs raktáron" felirat / aktív a Kosárba gomb)
  - Eredmény: `{ available: true/false, size: "4XL", url, screenshot }`
- Ha `available: true` és előzőleg `false` volt → **Telegram üzenet** a Lovable Telegram connectorán keresztül („Decathlon: most kapható 4XL [terméknév] — [link]").
- Adott a duplikáció elleni védelem: utolsó N futás eredménye alapján csak állapotváltozáskor küld értesítést.

> Még meg kell mondanod a konkrét **Decathlon termékoldal URL‑t** (egy konkrét fitness pólóét, amit figyelni szeretnél), és hogy **mire jöjjön a Telegram‑értesítés** (csak a saját Telegram fiókodra, vagy egy csoportba). Telegram connector kell — ha még nincs csatlakoztatva, a megvalósításnál szólni fogok.

## 5. Lépések (sorrend)

1. **Tisztítás a kódban**: Steel.dev‑hivatkozások eltávolítása a Brainből és a workerből.
2. **Job‑API**: `src/routes/api/public/worker/{claim,heartbeat,complete}.ts` + `WORKER_API_TOKEN` titok.
3. **Worker átírása** a service‑role helyett a publikus job‑API‑ra (orchestrator).
4. **`monitor` workflow‑típus**: új mező a workflow‑n (`schedule_minutes`, `last_state`), cron, ami időzítve sort rak a `workflow_runs`‑ba.
5. **Decathlon executor szkript** + Telegram értesítés (connector + szerver fn).
6. **VPS oldali telepítés**: pontos parancsok, amiket a `kylo` felhasználóval lefuttatsz (Docker telepítés, repo lehúzás vagy fájlok scp‑zése, `.env` kitöltése, `docker compose up -d --build`).
7. **Első éles teszt**: manuális futtatás a felületről („Futtasd most"), majd időzített futás.

## Technikai részletek (ha érdekel)

- Egyetlen képet építünk (`kylo-executor`), egy konténer = egy futás. Az orchestrator hosszan él, dockert spawnol.
- A worker‑oldali `.env` csak ennyit fog tartalmazni: `BRAIN_URL=https://brain.kylosystems.com`, `WORKER_API_TOKEN=...`, `WORKER_ID=worker-1`, `MAX_PARALLEL=4`.
- A `WORKER_API_TOKEN`‑t a Lovable secret store‑ba mentem, a VPS `.env`‑be pedig ugyanazt az értéket írjuk be — neked csak egyszer kell bemásolni a szerverre.
- Telegram: értesítés a Brain szerverfüggvényéből megy ki (a worker nem küld közvetlenül), így a token nem szivárog a VPS‑re.

## Kérdés feléd, mielőtt elkezdem

1. Rendben az, hogy **csak a worker (KyloKit) megy a te szerveredre**, a Brain Lovable Cloud‑on marad?
2. Adsz egy **konkrét Decathlon termék URL‑t** a figyeléshez, vagy generikus „bármilyen 4XL fitness póló a Decathlonon" típusú listafigyelés legyen?
3. Telegram értesítés: **saját DM** vagy egy csoport? (Ehhez kell a chat_id, amit a beüzemelésnél meg fogunk szerezni.)
