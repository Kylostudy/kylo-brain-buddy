## Cél

Ma este a LinkedIn Company Page metrikákat elindítjuk. A felhasználó NEM lép be a Dolphinból, hanem a Brain saját recorder böngészőjéből lép be manuálisan LinkedInre — és a session sütiket a rendszer automatikusan elmenti a workflow credential-be. Ezután a `metrics_snapshot` executor már a friss sütikkel fut.

## Két nyitott hiányosság, amit előbb pótolni kell

1. **A recorder ma nem a workflow proxyját használja.** A `worker/recorder/index.js` a saját `PROXY_1..N` pooljából választ körkörösen. Ha a LinkedIn NL account eddig a `188.215.81.43` IP-n élt, és most más IP-ről lépünk be, azonnali bot-gyanú → captcha vagy checkpoint.
   → A recordernek **ugyanazt a proxyt** kell használnia, ami a workflow-hoz van rendelve (`workflow_credentials.proxy_id` → `proxies` tábla).

2. **A recorder ma nem menti a sütiket.** A frame loop és action log van csak. A stop után a browser context becsukódik, minden süti elveszik.
   → Kell egy "cookie capture" lépés: mielőtt a recorder becsukja a contextet, olvassa ki `context.cookies()`-t, és küldje POST-tal a Brainnek egy új végponton, ami titkosítva beírja a `workflow_credentials.cookie_ciphertext`-be.

## Lépések

### 1. Backend — új cookie-mentő végpont
- `src/routes/api/public/worker/save-cookies.ts` (worker-token auth, mint a többi worker végpont).
- Bemenet: `{ sessionId, cookies: [...] }`. Kikeresi a session-t → workflow_id → tenant_id. A LinkedIn-releváns sütiket (`li_at`, `JSESSIONID`, `lidc`, `bcookie`, `bscookie`, stb.) JSON-ba szerializálja, és a meglévő `encryptString`-gel titkosítva beírja a workflow `workflow_credentials` sorába (upsert, ha még nincs credential row). Ha nincs elég süti (pl. csak 2 db, `li_at` nélkül) → 400-as hibaválasz, hogy a recorder ne mentsen félsikeres sessiont.

### 2. Backend — proxy visszaadása a recordernek
- `src/routes/api/public/worker/record-claim.ts` bővítése: miután megkapjuk a session-t, betöltjük a workflow-hoz tartozó proxyt (`workflow_credentials.proxy_id` → `proxies` tábla), és a válaszban visszaadjuk `proxy: { server, username, password }` formában. Ha nincs proxy hozzárendelve → hibaüzenettel visszautasítjuk a claim-et (nem indul el a session olyan workflow-hoz, ahol nincs kijelölt IP).

### 3. Worker — recorder javítása
- `worker/recorder/index.js`:
  - Ha a Brain claim válaszban van `proxy`, azt használjuk a `browser.newContext({ proxy })`-hoz a random pool helyett.
  - A locale/timezone-t is a workflow `language`/`timezone` mezőjéből vesszük (Brain küldi le, default: `hu-HU`/`Europe/Budapest`, hogy a mostani viselkedés ne törjön).
  - Új broadcast event: `saveCookies` — amikor a modal "Süti mentése" gombját nyomjuk, a recorder kiolvassa `context.cookies()`-t, és POST-olja a `/api/public/worker/save-cookies`-nak. Sikerre visszaküldi channelre `cookiesSaved` eventet, hibára `cookieSaveError`-t.

### 4. Frontend — recorder modal új gomb
- `src/components/browser-recorder-modal.tsx`: új "Sütik mentése workflow-ba" gomb (csak akkor aktív, ha a session `active`), ami a `saveCookies` broadcastot küldi. Visszajelzés toast-tal.

### 5. LinkedIn metrics workflow rendbetétele
- A jelen "NL Linkedin" (id: `10c4288f-...`) valójában egy warmup workflow (`monitor_type: logged-out-warmup`, `duration_min: 45`). A metrics-hez KÜLÖN workflow kell:
  - Új workflow: **"NL LinkedIn – Company Metrics"**, `module=brain`, `platform=linkedin`, `spec.brain_task.task_type=metrics_snapshot`, `spec.linkedin_company_slug=127334023`, `spec.post_limit=15`.
  - Ehhez rendeljük a **holland proxyt** (ugyanaz az IP, amin a NL warmup megy — `188.215.81.43` a memória szerint). Egy tenant × egy platform × egy IP = egy account, tehát a warmup és a metrics ugyanazon a proxyn ugyanazt az accountot használja, ami helyes.
  - A süti a bejelentkezés után ide kerül majd.

### 6. Élesítés (a fenti kód után)
1. Megnyitod a "NL LinkedIn – Company Metrics" workflow-t.
2. Rákattintasz "Böngésző felvétel indítása"-ra.
3. A recorder betölti a `linkedin.com/login`-t **a NL proxyn keresztül**.
4. Beírod az emailt, jelszót, 2FA-t (ha van).
5. Ellenőrzöd, hogy admin jogod van-e a `127334023` company page-en.
6. Megnyomod a **"Sütik mentése workflow-ba"** gombot → toast: "Sütik elmentve (N db)".
7. Bezárod a recordert.
8. Kézzel sorba teszed a metrics_snapshot taszkot (vagy megvárod a scheduled dispatch-et) → a worker a friss sütikkel lefut, elmenti az utolsó 15 poszt impressions/reactions/comments/reposts adatait.

## Miért így és nem másképp

- **Miért nem headless auto-login?** LinkedIn 2FA challenge-t dobhat (email vagy SMS), amit headless-ból nagyon nehéz kezelni, és ma reggel épp kidobta a session-t → most a legrosszabb pillanat lenne headless próbálkozásra.
- **Miért a workflow proxya, nem random?** Mert a LinkedIn az account × IP párost figyeli. Új IP-ről bejelentkezés = "new sign-in from unusual location" mail + potenciális checkpoint.
- **Miért külön workflow a metrics-re?** Mert a warmup és a metrics teljesen más `monitor_type`/`brain_task` — ugyanabba a spec-be zsúfolva átláthatatlan. A memóriabeli architektúra is külön workflow-t ír elő különböző feladatokra.

## Kockázatok, amiket most vállalunk

- Ha az NL warmup workflow-hoz még nincs proxy hozzárendelve a `workflow_credentials`-ban, akkor először azt kell megadni (proxy dropdown a workflow oldalon). Ez 1 kattintás, de ma este ellenőrizni kell.
- A recorder mostani HU locale/TZ default-ja NL bejelentkezésnél nem életszerű — a 3. lépéssel `nl-NL`/`Europe/Amsterdam`-ra állítjuk NL workflow esetén.

## Utána (nem ma)

- Ugyanez a folyamat automatikusan használható lesz TikTok / Pinterest / Instagram cookie-frissítésre is — a recorder oldali `saveCookies` platform-független.
