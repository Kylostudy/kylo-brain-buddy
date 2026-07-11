---
name: scaling-strategy
description: Skálázási irány — record & replay + spec-alapú építőkockák, VPS build nélkül. Új workflow-hoz SOHA ne kelljen VPS-en kódot buildelni.
type: preference
---

# Skálázási irány (user döntése)

**Alapelv:** A VPS-en új workflow-hoz kódot írni és buildelni NEM járható út. A user (és a jövőbeli userek) nem férnek hozzá a VPS-hez, tehát minden új workflow-nak VPS build nélkül kell létrejönnie.

## Elfogadott irány

1. **Record & Replay a fő út** — a user felveszi a folyamatot a böngésző-recorderrel, a spec DB-ben tárolódik, a VPS-en futó generikus replay executor lejátssza. VPS kód nem változik.
2. **Építőkockás (LEGO) architektúra** — a workerben egy fix készletű, generikus step-készlet van (navigate, click, type, scroll, wait, screenshot+vision, cookie mentés, feltételes ág stb.). Új workflow = új spec ezekből az építőkockákból, NEM új JS fájl.
3. **VPS kód csak akkor változik**, ha egy step-típus tényleg hiányzik a készletből, vagy platform-szintű alacsony szintű dolog kell (pl. új fingerprint patch). Sima "warmup / upload / metrics más platformon" NEM ilyen.

## User saját workflow-mátrixa
A user saját mátrixa lesz a legbonyolultabb — nagyon sokféle feladatot fed le. Ez a mátrix adja majd a valódi tesztet és a bővítendő építőkocka-listát. Új step-igény onnan jön, nem elméletből.

## Mit NE csináljunk
- Ne írjunk platformonként külön `xy-upload.js` / `xy-warmup.js` fájlt, ha spec+replay-jel megoldható.
- Ne kérjünk a usertől VPS parancsot új workflow bevezetéséhez.

## Következő lépés (később, most máson dolgozunk)
Amikor visszatérünk erre: nézzük végig a meglévő executor scripteket (linkedin-metrics, pinterest-upload, tiktok-upload stb.), és bontsuk generikus step-készletre, hogy spec-ből futtathatók legyenek.
