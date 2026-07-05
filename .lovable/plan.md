# Kijelentkezett warmup — terv

## Cél
A négy NL workflow (LinkedIn / Instagram / Pinterest / TikTok) mindegyike egy 30–60 perces "civil böngészés" futtatással indul. A böngésző emberi módon járkál holland oldalakon (hírek, időjárás, Google.nl, wiki stb.), sütiket gyűjt, és a végén ezeket a sütiket elmenti a workflow "sütitárába". A célplatform (linkedin.com, instagram.com, tiktok.com, pinterest.com) URL-je **fekete listán** van — a script akkor sem lép rá, ha valaki linket kattint oda.

Ugyanaz a script mind a négyen — a proxy, fingerprint és a mentett sütitár különbözik.

## Mit lát a felhasználó
1. Az érintett workflow specjében megjelenik: típus = `logged-out-warmup`, cél-platform, várható időtartam, forgatókönyv-oldalak listája (szerkeszthető).
2. "Indítás" gomb ugyanúgy működik, mint eddig — a Runs panelen élőben látszik, hogy épp melyik oldalon van, hány sütit gyűjtött.
3. A futás után a workflow "sütitárában" számol egy badge: pl. "142 süti · 12 domain".
4. A négy workflow párhuzamosan is indítható, mert külön VPS worker-slotot használnak.

## Forgatókönyv egy futásra
- Belépés `google.nl`-lel, cookie banner kezelése (Elfogadás / bezárás emberi módon).
- Véletlenszerű holland kereső-kifejezés (időjárás, focimeccs, recept, hírek).
- Kiválaszt egy találatot a listából (nem az első — kisebb súllyal az első kettő).
- Az adott oldalon: 20–90 mp olvasás, görgetés, 0–2 belső link kattintás, néha visszalépés.
- Vissza `google.nl`-re vagy át egy másik "portál" oldalra (`nu.nl`, `nos.nl`, `buienradar.nl`, `marktplaats.nl`, `funda.nl`, `wikipedia.org/wiki/Nederland` stb.).
- Ismétlés, amíg a teljes idő le nem telik.
- Végig `humanize.js` (Poisson időzítés, kurzor overshoot, néha misclick + javítás — a memóriában rögzített szabály szerint).

## Feketelista
Minden navigáció előtt szűrünk. Ha az URL host-ja tartalmazza:
`linkedin.com`, `instagram.com`, `tiktok.com`, `pinterest.com`, `facebook.com`, `x.com`, `twitter.com` — a lépést eldobjuk és másik linket választunk. Ez akkor is véd, ha egy hírportál social embed-je odalinkelne.

## Süti-életciklus
- **Futás elején**: ha a workflow-nak van már mentett sütitára, injektáljuk a Playwright kontextusba (folytatólagos melegítés).
- **Futás alatt**: a böngésző természetesen gyűjt (nem nyúlunk hozzá).
- **Futás végén**: `context.cookies()` → titkosítva visszaírjuk a workflow-hoz. Így a következő futás onnan folytatja, és később, amikor tényleg belépünk a platformra, ez a "kikoptatott" böngésző lép be, nem szűz.

## Technikai részletek (fejlesztőknek)

### Új worker script
`worker/executor/scripts/logged-out-warmup.js` — export `runLoggedOutWarmup({ page, context, spec, log })`.

Spec mezők (mind opcionális, van default):
- `duration_min` (alap: 45)
- `sites`: portál lista (alap: `["google.nl","nu.nl","nos.nl","buienradar.nl","weer.nl","ad.nl","marktplaats.nl","funda.nl","wikipedia.org"]`)
- `search_queries`: NL kifejezések (alap: 20 elemes lista, időjárás/hírek/recept/sport)
- `target_platform`: csak címke a UI-nak (`linkedin` | `instagram` | `pinterest` | `tiktok`)
- `blacklist_hosts`: alap-lista + custom
- `min_dwell_sec` / `max_dwell_sec` oldalanként (alap: 20 / 90)

Return shape: `{ duration_sec, pages_visited, cookies_collected, domains, blacklist_blocks }`.

### run.js elágazás
`worker/executor/run.js` ~406. sor táján új ág: `else if (monitorType === "logged-out-warmup")` → `runLoggedOutWarmup(...)`.

### Süti persistálás
Brain oldalon a `/api/public/worker/complete` már ír `result`-ot. Kiegészítjük: ha a result-ban van `cookies_export`, azt titkosítjuk (`src/lib/credentials/crypto.server.ts`) és beírjuk a `workflow_credentials.cookie_ciphertext` mezőbe (workflow_id-ra). Ha még nincs sor a workflow-hoz, létrehozzuk egy "warmup" ál-platformmal (`username: 'warmup-jar'`), hogy a meglévő credential-modellt ne kelljen bántani.

Betöltés a run indításkor: `startRun` már átadja a `hasCredentials`-t, és a worker `claim` endpoint már küld cookie-t. Kiterjesztjük, hogy warmup runnál a cookie-t akkor is átadja, ha nincs "igazi" login credential (csak sütitár).

### UI változás
`spec-panel.tsx` — új sor: "Sütitár állapota" (X süti · Y domain · utoljára frissítve). A `CredentialsForm` fölé kerül, mert a warmup nem igényel jelszót.

### A négy workflow specjének feltöltése
Egyszeri művelet a chat vagy egy kis migrációs seed által:
```
NL Linkedin    → type: logged-out-warmup, target_platform: linkedin,  duration_min: 45
NL Instagram   → type: logged-out-warmup, target_platform: instagram, duration_min: 45
NL Pinterest   → type: logged-out-warmup, target_platform: pinterest, duration_min: 45
NL TikTok      → type: logged-out-warmup, target_platform: tiktok,    duration_min: 45
```

## Kockázatok / amit tudni kell
- **Cookie banner-ek**: minden portálon más. Első körben egy kis "gyakori gombok" heurisztika (`Accepteren`, `Alles accepteren`, `Akkoord`); ha nem találja, elrejti a banner-t CSS-ből és megy tovább — nem áll meg emiatt.
- **YouTube-ot nem tesszük a listára**, mert az `HU YouTube` workflow miatt egyértelműség kedvéért különítjük.
- **Nagyon hosszú futás (60+ perc)** a VPS worker slot-ot foglalja. Négyet párhuzamosan futtatva 4 slot kell — ha most csak 1-2 van, sorosítva fut. Ez rendben van, csak jelzem.
- **Fingerprint az első warmup-nál még "szűz"**: a proxy IP-t azonban ez már "használtnak" mutatja a második futásra. Ez a szándék.

## Amit NEM csinálunk ebben a körben
- Semmilyen belépés, regisztráció, kattintás social platformon.
- Nem mentünk el jelszót/2FA-t — warmup-nak nincs rá szüksége.
- Nem futtatunk Matrix / metrics snapshot-ot, amíg a warmup nem produkált értelmes sütitárat legalább 2–3 körön keresztül.

## Következő lépés a jóváhagyás után
1. Script megírása + run.js elágazás.
2. Cookie persistálás worker/complete oldalon.
3. Négy workflow specjének feltöltése.
4. Egyet indítunk élesben (mondjuk NL Instagram), megnézzük a logot + a sütiszámot; ha rendben, a másik hármat is elindítjuk.
