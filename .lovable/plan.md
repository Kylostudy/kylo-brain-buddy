# Kylo.study QA Audit — világszínvonalú tesztelő rendszer

Cél: Az Audit modulban egy olyan robot workflow, ami végigkattintja a kylo.study minden oldalát, minden nyelven és skinnel, és **minden** vizuális/fordítási hibát megtalál. Az eredmény egy dedikált riport oldalon jelenik meg, ahonnan egy-kattintással másolható AI-patch csomag generálható a Lovable chatbe.

## 1. Adatbázis (új táblák — Audit tenant scope-olt, RLS-sel)

**`audit_qa_runs`** — egy teljes végigfutás (25 nyelv × N skin).
- `id`, `tenant_id`, `workflow_id`, `started_at`, `finished_at`
- `status` (running / completed / failed)
- `total_pages_visited`, `total_issues_found`, `total_cost_usd`
- `config` jsonb (nyelvek, skinek, base URL, credentials ref)

**`audit_qa_issues`** — minden egyes hiba egy sor.
- `id`, `run_id`, `tenant_id`
- `severity` (critical / major / minor)
- `category` (translation_missing / translation_wrong / contrast / missing_back_button / broken_layout / clipped_text / navigation_dead_end / other)
- `language`, `skin`, `page_url`, `page_title`
- `expected_language`, `detected_language`, `problematic_text`
- `screenshot_path` (Supabase Storage, aláírt URL), `screenshot_annotated_path`
- `dom_context` jsonb (közeli szelektor, DOM path, elem szöveg)
- `ai_diagnosis` text, `ai_suggested_fix` text
- `status` (open / fixed / wont_fix / duplicate)
- `dedupe_hash` (kategória + normalizált szöveg + hely → duplikátumok kiszűrése)
- `created_at`, `resolved_at`

**`audit_qa_coverage`** — mit járt már be a robot (perzisztens térkép, resumable).
- `run_id`, `url`, `language`, `skin`, `visited_at`, `interactions_count`, `screenshot_hash`

Migráció + GRANT + RLS (tenant scope-olt, `tenant_has_module('audit')` gate).

## 2. Storage bucket

`audit-qa-screenshots` — privát bucket, csak service_role ír, authenticated olvas aláírt URL-lel a saját tenantján belül.

## 3. Worker task: `kylo_study_qa` (Audit modul, robot profile)

Új file: `worker/executor/scripts/brain-tasks/kylo-study-qa.js`

Menete (per nyelv × skin kombináció):
1. **Belépés**: főoldal → 7× kattintás a kutyás logóra → login form → megadott credentials → dashboard.
2. **Nyelv + skin beállítása** (első futásnál explicit, később iterál).
3. **Feltérképezés (crawl)**: BFS az összes belső linken + minden interaktív elem (`button`, `[role="button"]`, klikk-esemény listener) — a `audit_qa_coverage` alapján resumable.
4. **Minden oldalon**:
   - Screenshot (teljes oldal + viewport).
   - DOM szöveg kivonat (látható szövegek + a hozzájuk tartozó szelektor).
   - Gemini vision hívás (`google/gemini-2.5-flash` — olcsó, elég jó) — a screenshot + az elvárt nyelv + a kinyert szövegek.
     - Kérdések: (a) Minden látható szöveg az elvárt nyelven van? (b) Van-e nem lefordított rész? (c) Látszik-e minden szöveg (kontraszt)? (d) Van-e levágott/kilógó tartalom? (e) Ha nem a főoldal, van-e vissza gomb / navigáció?
   - Kétes esetekben eszkalálás Gemini Pro-ra (`google/gemini-2.5-pro`) — pontosabb, drágább.
5. **Minden talált hiba** → `audit_qa_issues` sor + screenshot storage-ba + `dedupe_hash` alapján ha már láttuk ugyanezt, csak számláló nő.
6. **Zsákutca-detektor**: ha egy oldalra kattint és utána nem tud visszamenni ↔ `navigation_dead_end`.
7. **Költségkövetés**: minden AI hívás után a `run.total_cost_usd` frissítése.

Az `audit` modul már a RobotProfile-t kapja (`src/lib/behavior/index.server.ts`) — nincs mesterséges lassítás.

## 4. Vision API endpoint bővítés

A meglévő `src/routes/api/public/worker/vision-extract.ts` már használható. Kiegészítjük egy `audit-qa-analyze` variánssal (`src/routes/api/public/worker/audit-qa-analyze.ts`), ami előre huzalozott promptot + JSON schemát ad Gemini-nek, és visszaadja a strukturált hibalistát. Költséget is jelent vissza (usage tokens → USD).

## 5. UI — Audit modul QA riport oldal

Új route: `src/routes/_authenticated.audit.qa.tsx` (csak `audit` module tenant számára).

**Nézetek:**
- **Áttekintés kártyák**: aktuális run státusza, összes hiba súlyosság szerint, becsült/tényleges költség, coverage % (bejárt oldalak / összes talált oldal).
- **Hiba táblázat**: szűrhető nyelv / skin / kategória / súlyosság / státusz szerint. Sor kattintásra részletek modal (screenshot, DOM context, AI diagnózis + javaslat, "Mark fixed" gomb).
- **Nyelvi mátrix**: 25 nyelv × N skin heat-map, cellánként hibaszám.
- **AI-patch csomag export**: kiválasztott hibákhoz "Copy AI patch prompt" gomb — a vágólapra rakja a teljes Markdown csomagot (lásd 6. pont), amit direkt bemásolsz a kylo.study projekt Lovable chatjébe.
- **"Start new run"** gomb + config (nyelvek, skinek kiválasztása, vagy "mind").

## 6. AI-patch csomag formátum (a Copy gomb erre generál)

```markdown
# Kylo.study QA javítás — [YYYY-MM-DD] futás
Környezet: nyelv=hu, skin=magic-school, base=https://kylo.study
Összes hiba ebben a csomagban: 12

---

## [HIBA #1 — critical] Fordítás hiányzik
**Oldal**: /lessons/intro (nyelv beállítás: hu)
**Kategória**: translation_missing
**Szelektor**: `main > section:nth-of-type(2) > h2`
**Talált szöveg**: "Welcome to your journey"
**Elvárt**: magyar fordítás
**AI javaslat**: Add hozzá a `locales/hu.json`-hoz: `"lessons.intro.welcome": "Üdvözlünk az utazásodon"` és cseréld a komponensben `t('lessons.intro.welcome')`-re.
**Screenshot**: <aláírt URL 7 napra>

---

## [HIBA #2 — major] Nincs vissza gomb
...
```

Ez pontosan az a formátum, amit a kylo.study projektben egy prompttal én (vagy egy programozó) végig tud pörgetni.

## 7. Az audit rendszer öntesztje ("teszteljük az auditot is")

Új workflow: `audit_self_test` — egy sarok-eset gyűjtemény minta oldalakkal (szándékosan hibás HTML fixtures a `worker/executor/fixtures/audit-self-test/` alatt, staticként a workeren szervírozva). Ez tartalmaz: hiányzó fordítás, rossz kontraszt, hiányzó vissza gomb, levágott szöveg. Ellenőrzi, hogy a `kylo_study_qa` task **mind** megtalálja-e őket. Ez CI-szerűen fut minden nagy változáskor.

## 8. Skálázhatóság — most építjük be

- **Resumable crawl**: ha megszakad, a `audit_qa_coverage` alapján folytatja.
- **Párhuzamosítás**: nyelvenként külön worker task — a `brain_task_queue`-ba több sor kerül. Egy tenant több VPS workerrel is dolgozhat.
- **Deduplikáció**: `dedupe_hash` — ugyanaz a hiba több oldalon egy soron gyűjtődik (count++).
- **Költségplafon**: run indításkor USD limit, elérésekor auto-stop + jelzés.

## 9. Titkok

A kylo.study bejelentkezéshez credentials kell — a meglévő `workflow_credentials` táblát használjuk (encryption már megvan, `src/lib/credentials/crypto.server.ts`). A workflow beállításánál megadod majd az emailt/jelszót a UI-n keresztül.

## Bevezetési sorrend

1. Adatbázis migráció (táblák, GRANT, RLS, storage bucket).
2. `audit-qa-analyze` API + backend server functions (run indítás, hibalista fetch, patch generálás).
3. Worker task `kylo-study-qa.js` (crawl + vision + issue mentés).
4. UI riport oldal.
5. Öntesztelő fixture-ök + `audit_self_test` workflow.
6. Első éles futás: hu / magic-school → első hibalista → AI-patch csomag → visszaadod nekem a kylo.study projekthez.

## Technikai megjegyzések

- Robot behavior profile (`audit`) már létezik, nincs emberi késleltetés.
- Vision költség: Gemini 2.5 Flash ~$0.30 / 1M input token, egy screenshot ~1000 token. 12500 screenshot ≈ ~$4 alap ellenőrzésre; Pro eszkaláció + retry-k ≈ $10-15 realistában. $50 keret kényelmesen elég.
- Storage: JPEG 60% quality, teljes oldal screenshot ~200KB → 12500 × 200KB = ~2.5 GB / futás. Régi run-ok 30 nap után auto-purge.
