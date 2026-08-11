# Felderítő görgetés + képernyőfotó → AI-tanulás (LinkedIn elsőként)

## Miért
A poszt akkor bukik el, amikor a LinkedIn megváltoztatja a felületet, és a merev
gombkeresés nem talál semmit. Ha a rendszer *előre* megnézi, hogy néz ki ma az
oldal, és ebből magának megtanulja a helyes fogódzókat, a posztolás nem hasal el.
Egyben ez emberi viselkedés is: valódi ember is nézelődik két poszt között.

## 1. lépés — Felderítő járat (`ui_recon`)
Új feladattípus a workerben. Nem kattint, nem posztol, csak:
- belép a mentett sütikkel, görget a hírfolyamban emberi tempóban,
- megáll a fontos pontokon (hírfolyam teteje, poszt-szerkesztő nyitott állapota,
  céges admin nézet), és **képernyőfotót készít** ezekről,
- minden fotóhoz elmenti az oldal URL-jét, a látható gombok feliratait és a
  gyanús DOM-jelöléseket (aria-label, data-* attribútumok),
- feltölti a fotót a tárolóba, a mérést pedig egy új `ui_recon_snapshots`
  táblába.

Ütemezés: naponta 2–3 alkalommal, véletlen időpontban, a csendes ablakon kívül,
és **kötelezően minden posztolás előtt 20–40 perccel**.

## 2. lépés — Gemini Vision elemzés
A Brain oldalán (`/api/public/worker/ui-recon-analyze`) a fotó + a DOM-kivonat
megy a Gemini Visionhöz ezzel a kérdéssel:
- „Hol van a poszt-indító gomb? Hol a szövegmező? Hol a Közzététel gomb?”
- válasz strukturáltan: mező → javasolt szelektor → magabiztosság → indoklás.

Ami 0.8 feletti magabiztossággal jön, az bekerül a már meglévő
`worker_learned_selectors` táblába (`learned_from: gemini_vision`).

## 3. lépés — A posztoló használja a tanultat
A `linkedin-post.js` sorrendje ezután:
1. tanult szelektorok lekérése (`lookupLearnedSelectors`),
2. beépített (hard-coded) lista mint tartalék,
3. ha egyik sem talál: **azonnali önjavítás** — fotó + Vision hívás menet közben,
   az új szelektorral újrapróbálja, és a sikeres találatot elmenti.

Minden találatnál `success: true`, minden bukásnál `success: false` — így a rossz
szelektor magától kikopik.

## 4. lépés — Változás-riasztás
Ha a felderítő járat olyan felületet lát, ami eltér a legutóbbitól (Gemini
összehasonlítja a két fotót), Telegram üzenet megy: „🔵 LinkedIn felület
megváltozott — az új fogódzókat megtanultam / nem sikerült megtanulni”.
Így nem posztolás közben derül ki a baj.

## 5. lépés — Felület a Brainben
Új oldal (`/recon`): időrendben a felderítő fotók, mellettük mit tanult a rendszer,
mi a mostani szelektor, mikor működött utoljára. Egy gombbal kézzel is
újrataníttatható.

## Technikai részletek
- Új tábla: `ui_recon_snapshots` (tenant_id, platform, page_type, url,
  screenshot_path, dom_digest jsonb, analysis jsonb, created_at) — RLS + GRANT.
- Tároló: meglévő Supabase Storage bucket, tenant szerinti mappában.
- Új worker szkript: `worker/executor/scripts/brain-tasks/ui-recon.js`,
  regisztrálva a `brain-tasks/index.js` routerben.
- Új Brain végpontok: `ui-recon-ingest.ts`, `ui-recon-analyze.ts`
  (`/api/public/worker/`), a meglévő worker-token védelemmel.
- A `linkedin-post.js` szelektor-keresése kiszervezve egy közös
  `resolve-selector.js` segédbe, hogy Reddit/Pinterest is használhassa.
- Nincs Docker-újraépítés a szelektorokhoz: a tanult értékek adatbázisból jönnek.

## Sorrend
1) tábla + végpontok, 2) `ui-recon.js` felderítő, 3) Vision-elemzés és tanulás,
4) posztoló átkötése a tanultra, 5) Telegram riasztás, 6) `/recon` felület.
