# Project Memory — Kylo Brain

## Core
Non-technical user, kommunikáció magyarul, közérthetően, zsargon nélkül.
Brain fő célja: Facebook / TikTok / YouTube fiókokba bejelentkezés süti/session alapján és videófeltöltés — NEM webshop scraping.
Decathlon tesztfeladat lezárva: Cloudflare Turnstile blokkol, nem fejlesztési kérdés. Ne próbáljuk újra.
Recorder infrastruktúra (VPS + IPRoyal ISP proxy + Steel) működik; session-alapú login (FB/TikTok) korábban már működött amszterdami VPS-ről.
FUTÁSI TILALOM: 17:00–23:00 budapesti idő között SEMMILYEN worker futás. Bemelegítés csak helyi idő szerint 09:00–21:00.
MUNKAFEGYELEM: egy folyamatot végig kell vinni, nem ugrálunk. Félbehagyott = elfelejtett = későbbi probléma.


## Memories
- [Holnapi terv](mem://todo/tomorrow-plan) — Stealth plugin + holland warmup + LinkedIn/TikTok bemelegített workflow (2026-07-05)
- [LinkedIn — régi elavult](mem://todo/linkedin-tomorrow) — ELAVULT: Dolphin cookie stratégia megbukott, helyette a holnapi terv lép érvénybe
- [Függő feladatok](mem://todo/pending) — Privacy policy + security oldalak, Kai Logic integráció, magyar IP beszerzés, Kubernetes VPS kezelés
- [Kai Logic integráció terv](mem://features/kai-logic-integration) — Core Hub bekötés, tenant összehangolás, AirShare kiváltása
- [Workflow UI csoportosítás](mem://features/workflow-ui-grouping) — Későbbi UI feladat: platform szerinti csoportosítás ~15-20+ workflow-nál
- [Munkafegyelem](mem://features/work-discipline) — Egy folyamat = végigvinni, nem ugrálni másikra közben
- [VPS worker repó](mem://features/vps-worker-repo) — worker/ mappa ebben a repóban él; deploy: git pull + docker compose build a VPS-en
- [Skálázási irány](mem://features/scaling-strategy) — Record & replay + spec-alapú építőkockák. Új workflow-hoz SOHA ne kelljen VPS build.
- [Warmup fogalmak](mem://features/warmup-terminology) — „Reddit warmup" = a Reddit FIÓK bemelegítése (görgetés, upvote); „országos warmup" = proxy sütigyűjtés. Két külön dolog.
- [Hibás IPRoyal proxyk](mem://features/broken-iproyal-proxies) — FR és HK proxy folyamatosan rossz geolokáció, cserét kell kérni.
- [napi-reddit-melegítés](mem://features/daily-reddit-warmup) — Minden aktív Reddit fiók naponta 1× bemelegszik; pg_cron ütemezi, VPS rebuild után is fut
- [futási időablakok](mem://features/run-time-windows) — Esti 17-23 budapesti tilalom minden futásra; bemelegítés csak helyi nappal
- [esti-fejlesztoi-mod](mem://features/live-dev-mode) — Élő szkript-becsatolás build nélkül a workeren (17:00–08:00), live.sh kapcsoló, biztonsági fékek
