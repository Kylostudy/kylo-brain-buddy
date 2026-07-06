# Terv: A verzió — Felvétel egyszeri lejátszása, cookie mentés, utána cookie-ból megy

## Mit akarunk elérni

A most rögzített 84 lépéses felvételt (cookie elfogadás → email → jelszó → 2FA → navigáció) **egyszer** lejátsszuk a saját workerünkkel. Amint bent vagyunk a LinkedIn-en, elmentjük a session cookie-kat a workflow credentialjébe. Onnantól a már meglévő `linkedin-metrics-snapshot` executor cookie-ból tud dolgozni — nem kell minden futásnál újra belépni.

Ha a cookie lejár (jellemzően pár hét múlva), akkor újra lejátszatjuk a felvételt egyszer.

## A négy építőkocka

### 1. Új executor: `record-replay.js`
Új fájl a worker oldalon: `worker/executor/scripts/brain-tasks/record-replay.js`.

Mit csinál sorban:
- Betölti a workflow `spec.recorded_actions` tömbjét (amit épp most mentettünk).
- Új Playwright böngészőt indít a workflow proxyján.
- Sorra végigmegy a lépéseken: `navigate`, `click` (koordináta alapján), `type` (szövegbeírás emberi ritmussal), `key` (Enter, Tab stb.), `scroll`, `wait`.
- **Emberi viselkedés kötelező** (memory szabály): a lépések között nem az eredeti `t` időpont, hanem Poisson-jitter; kattintás előtt kurzor overshoot; gépeléskor karakter-szintű random delay; alkalmi elgépelés + backspace.
- Ahol a spec `bitwarden_field`-et mond (jelszó, TOTP), ott nem a felvett szöveget írja be, hanem a workflow credentialból húzza (jelszó) vagy TOTP-t generál (`src/lib/credentials/totp.server.ts` már megvan).
- Végén: `page.context().cookies()` → visszaadja a fő doménre (`.linkedin.com`) szűrt cookie-listát.

### 2. Automatikus cookie-mentés a task végén
A worker `complete` callbackja már létezik (`/api/public/worker/save-cookies.ts`). A replay executor a végén ezen keresztül visszaküldi a friss cookie-kat, és a `workflow_credentials.value_encrypted.cookies` mezőbe kerül titkosítva.

Onnantól a `linkedin-metrics-snapshot.js` (ami már cookie-ból dolgozik) minden futásnál ezt olvassa.

### 3. Új task típus: `record_replay_login`
- Új sor a `brain_task_queue`-ba `kind = 'record_replay_login'` értékkel.
- A dispatcher és a worker executor-router (`worker/executor/scripts/brain-tasks/index.js`) tudjon róla.

### 4. UI gomb: „Login lejátszása és cookie mentése"
A workflow chat oldalán egy gomb, ami:
- Ellenőrzi hogy van-e mentett felvétel + email + jelszó credential.
- Sorba tesz egy `record_replay_login` taskot.
- Élőben mutatja a task progress-ét (a `brain_workflow_runs` táblát már figyeljük).

Így holnap **egyetlen gombnyomással** lefut a login egyszer, és utána a rendszeres metrics futás cookie-ból megy.

## Mit NEM csinálunk most (holnapra hagyjuk)

- Nem indítunk éles LinkedIn futást ma (botgyanú-stop).
- A `record-replay.js`-t először egy ártalmatlan oldalon (pl. saját teszt-oldal, vagy `example.com`) próbáljuk ki üresben, hogy a lejátszó logika stabil.
- Az éles LinkedIn login-t holnap indítjuk kézzel a gombbal, én figyelem a logot, ha kidob akkor B verzió.

## Kockázatok, amiket vállalunk

- Ha a felvétel a jelszót/TOTP-t is konkrét karakterekként rögzítette (a felvétel során valós billentyűleütés volt), akkor **a spec ma tartalmazhatja plain szövegben a jelszót**. Ezt a replay executor első dolga kell hogy legyen letakarni: a `type` lépéseknél a jelszó és 2FA mezőknél nem a felvett `value`-t használjuk, hanem a credentialból/TOTP-ből. A felvétel spec-ben lévő plain jelszót viszont felül kell írnunk (biztonsági javítás). — ezt a Terv részeként megcsinálom.
- Cookie lejárat: pár hét múlva újra le kell játszani a login-t. Ez elfogadott, a Dolphin cookie-nál sem volt jobb.

## Sorrend

1. Biztonsági javítás: felvétel mentésénél a jelszó/2FA-jellegű `type` lépések `value`/`text` mezőjét nullázzuk és megjelöljük `bitwarden_field`-del (backfill a mostani felvételre is).
2. `record-replay.js` executor megírása humanize-ált lejátszóval.
3. `brain-tasks/index.js` router bővítése az új task-típussal.
4. Cookie-mentő callback illesztése a replay végére (a meglévő `/save-cookies` endpointra).
5. UI: „Login lejátszása" gomb a workflow oldalon.
6. Száraz teszt egy ártalmatlan oldalon (nem LinkedIn).
7. **HOLNAP:** éles LinkedIn login egy gombnyomással, cookie mentés, majd metrics teszt.

## Ha ez működik → Pinterest

A `record-replay.js` és a cookie-flow **platformfüggetlen**. Pinterestnél is ugyanez: felvétel a modálban → egyszer lejátszatjuk → cookie mentve → a Pinterest metrics/pin-poszt executorok cookie-ból mennek. Nem kell külön Pinterest-login kódot írni.

---

Rendben van így? Ha jóváhagyod, elkezdem az 1–6. pontokat még ma, és holnap csak a gombot kell megnyomni.
