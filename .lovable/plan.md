
# Cookie jar országvédelem

Cél: ha egy workflow-hoz már gyűjtöttünk sütiket adott ország proxyval (pl. NL), ne lehessen véletlenül más ország proxyjával elrontani. Az NL Instagram warmup közben ez fut a háttérben — nem érintjük.

## Mit lát a felhasználó

1. **Cookie jar badge a workflow fejlécében**
   ```
   [🇳🇱 NL] Cookie jar · 47 süti · 6 domain · 12 perce
   ```
   Ha még nincs süti: *„Cookie jar üres"* semleges badge.

2. **Puha figyelmeztetés a proxy dropdown-ban (alapértelmezett)**
   Ha a workflow cookie jar-jának országa NL, és USA proxyt választanál:
   - A dropdownban a más országhoz tartozó proxyk sárga háromszöggel jelennek meg.
   - Mentéskor egy megerősítő ablak: *„A cookie jar NL sütiket tartalmaz. Egy USA proxyval a fingerprint nem fog egyezni, és a következő futás valószínűleg letiltásba fut. Biztosan váltasz?"* — Mégse / Váltok.

3. **„Cookie jar védelem" kapcsoló a workflow beállításokban (kemény zár)**
   - Alapból KI.
   - Ha BE, a proxy dropdown csak a cookie jar országához illeszkedő proxykat mutatja. A más országúak szürkék és nem választhatók.
   - Ha meg akarod törni: külön gomb *„Cookie jar nullázása"* → megerősítés → titkosított sütik törölve, védelem automatikusan kikapcsol.

## Technikai megvalósítás

### Adatbázis (migráció)
`workflows` táblához:
- `cookie_jar_country` text — nullable, ISO country kód (pl. „NL")
- `cookie_jar_locked` boolean default false
- `cookie_jar_updated_at` timestamptz
- `cookie_jar_stats` jsonb — `{ cookies: 47, domains: 6 }` (opcionális gyors megjelenítéshez)

### Worker complete endpoint
`src/routes/api/public/worker/complete.ts` — amikor a `cookies_export`-ot lementi:
1. Lekéri a run `proxy_id`-jét → a proxy `country`-ját.
2. A workflow-ra írja: `cookie_jar_country`, `cookie_jar_updated_at = now()`, `cookie_jar_stats` (méret + egyedi domain szám a sütiken).
3. Ha `cookie_jar_locked = true` ÉS a futott proxy országa ≠ tárolt cookie jar ország → figyelmeztetést logol, de a sütiket akkor is menti (a védelem a UI-oldali választásra vonatkozik, nem az API-ra).

### UI
- **`src/components/credentials-form.tsx`** — a proxy dropdown már létezik. Kiegészítés:
  - Load workflow cookie_jar_country és cookie_jar_locked.
  - Dropdown item render: ha ország ≠ cookie_jar_country → sárga ikon + `title` figyelmeztetés. Ha locked, `disabled`.
  - Mentés előtt confirm dialog, ha ország eltér és nincs lock.
- **`src/components/workflow/*` (spec panel környék)** — új komponens: `CookieJarBadge` a fejlécbe.
- **Cookie jar védelem kapcsoló** — a spec panelbe egy kis szekció: kapcsoló + „Cookie jar nullázása" gomb.

### Cookie jar nullázás
Új szerver függvény `src/lib/credentials.functions.ts`-ben:
- `clearCookieJar(workflowId)` — `workflow_credentials.cookie_ciphertext = NULL`, workflow `cookie_jar_country = NULL`, `cookie_jar_locked = false`, `cookie_jar_stats = NULL`.
- Auth: `requireSupabaseAuth`, tenant ellenőrzés.

## Építési sorrend

1. Migráció: új mezők a `workflows` táblán.
2. `complete.ts` — cookie jar metadata írása mentéskor.
3. `CookieJarBadge` komponens + beillesztés a workflow fejlécbe.
4. `credentials-form.tsx` proxy dropdown figyelmeztetés + confirm dialog.
5. Spec panelbe kapcsoló + nullázás gomb + szerver függvény.
6. Az NL Instagram warmup végén magától megkapja az NL címkét — nem kell semmit tenni utólag.

## Amit NEM változtatunk

- A most futó NL Instagram warmup zavartalanul megy tovább.
- A worker script (`logged-out-warmup.js`) és a scheduled_runs dispatcher érintetlen.
- Egyéb workflow-k, proxy táblák, futási history — nincs változás.
