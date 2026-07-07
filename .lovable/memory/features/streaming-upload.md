---
name: streaming-upload
description: GCS → platform videó feltöltés stratégia. Most #1 (memória-buffer, nincs lemezírás). Későbbre #3 (régiónkénti upload worker). #2/b kihagyva.
type: feature
---

# Videó feltöltés GCS-ből — skálázási stratégia

## Probléma
100+ videó/nap esetén a "GCS → VPS lemez → platform" út nem skálázható:
- kétszer utazik a videó (GCS→VPS, VPS→platform)
- lemezterületet és I/O-t eszik
- párhuzamos futásoknál gyorsan elfogy a VPS erőforrása

## MOST — #1 megoldás: memória-buffer (implementálandó a feltöltés bekötésekor)

A `worker/executor/scripts/tiktok.js` (és a jövőbeli `instagram.js`, `pinterest.js`, `linkedin.js`) NE írjon lemezre.

Helyette:
- `fetch(gcs_signed_url)` → `response.arrayBuffer()`
- Playwright `setInputFiles([{ name, mimeType, buffer }])` — memóriából adja át a böngészőnek
- A böngésző a proxyn keresztül tölti fel

Előnyök:
- nincs `/tmp` lemezírás
- 100+ videó/nap simán skálázódik
- 3 sor változás scriptenként

Korlátok:
- a videó egy pillanatra a VPS RAM-on átmegy (nem tiszta pass-through)
- nagy fájlnál (>500 MB) RAM-igényes — TikTok/Reels 30–100 MB-nál teljesen OK
- a `downloadToTemp` függvényt le kell cserélni `fetchToBuffer`-re

## KÉSŐBBRE — #3 megoldás: régiónkénti upload worker konténerek

Amikor 200-500+ videó/nap fölé megyünk, VAGY amikor a főbb VPS-en zavaró a feltöltési forgalom.

Architektúra:
- Régiónként (USA, GB, CH, ES, HU, PL, SE, NL, CA, AU, MX, BR — 12 proxy régió) 1-1 kis upload konténer közel a proxyhoz
- A Brain VPS csak koordinál, task-okat oszt ki
- A feltöltő konténer streameli GCS-ből a fájlt a böngésző memóriájába, majd a proxyn feltölti
- A fő Brain VPS-t egyáltalán nem terheli a videó forgalom

Előnyök:
- teljes horizontális skálázás
- régió-lokális proxy latency (kevesebb timeout)
- fő VPS csak orchestration, nem sávszélesség-korlátos

Mikor kell nekiállni:
- 200+ videó/nap TARTÓS terhelés
- VAGY ha a fő VPS RAM/CPU-ja szűk keresztmetszet a #1 megoldással
- VAGY ha a fő VPS sávszélesség-számlája problémás

## KIHAGYVA — #2/b (browser-side fetch + File API)

Technikailag működne TikTok/Instagram/Pinterest-en is (nem a #2/a keverendő össze,
ami "import from URL" API-t igényel — az náluk nincs).

Miért nem csináljuk:
- köztes lépés #1 és #3 között
- ha úgyis #3 felé megyünk hosszú távon, kár időt szánni rá
- signed URL CORS-t igényel GCS oldalról → +Kylogic egyeztetés
- a proxy dupla forgalmat kap (GCS letöltés + platform feltöltés is rajta megy)

## Kylogic függőség
A `kylogic-upload-gap.md` felsorolja a hiányzó payload mezőket.
Amikor Kylogic beköti a signed URL-t, kérjünk **elég hosszú TTL-ű** URL-t
(min. a task futásáig + retry ablak, tehát 24h ajánlott).
