# Receptbeli betűk és részleges IELTS-folytatás

## Friss diagnózis

A VPS 2026-10-25 06:17 UTC jelentése: a kezelő aktív. 06:05:32 és 06:15:56 UTC naplóbejegyzése: `continuation_languages_restricted`. A hét nyelvű receptet a korábbi, pontosan 11 gyártható nyelvet megkövetelő szabály utasította el. Archívum-nyugtahiba ebben a naplóban nem szerepelt; a 16 nyugta teljes ellenőrzése csak sikeres új regisztrációval igazolható.

## KyLogic átadás

A recept változatlan `schema_version: 1`. A `continuation.blocked_languages` opcionális lista:

```json
[
  {"language": "ja", "reason": "font_renderer_trial_pending"},
  {"language": "ko", "reason": "font_renderer_trial_pending"},
  {"language": "ar", "reason": "font_renderer_trial_pending"},
  {"language": "hi", "reason": "font_renderer_trial_pending"}
]
```

A nyelvkódok kisbetűsek. A gyártandó, kész és indokoltan kimaradó nyelvek átfedés nélkül lefedik mind a 27 nyelvet. Csak az eredeti 11 hiányzó nyelv gyártható; kész nyelv nem kerülhet a gyártandók közé. A regisztráció önmagában nem indít gyártást.

A `video.font` opcionális fájlkulcs, például `fonts/notosans-jp-ttf`. Ennek szerepelnie kell a recept `files` listájában pontos mérettel és SHA-256 értékkel. A négy beszerzett Noto betű letöltési címe, mérete és ellenőrzőösszege az `infra/video-factory/font-assets/manifest.json` jegyzékében található. A `sample`, `url`, `source` mezőket ne másold a szigorú recept fájlbejegyzésébe; ott csak `key`, `bytes`, `sha256` megengedett. A betűt a KyLogic szolgálja ki az aláírt assets művelettel, ugyanúgy, mint a többi receptadatot. A licencek a jegyzék mellett vannak.

Új renderer: `ielts-promo-fonts-v1`; jelenet: a meglévő `ielts-promo-v1`. A régi `ielts-promo-v1` renderer és a kész cseh próba változatlan marad. Az új renderer hiányzó/sérült kiválasztott betű esetén hibával áll meg, nem gyárt kockás szöveget elfogadott videóként.

Először külön japán próbát küldj új receptazonosítóval/verzióval: `languages: ["ja"]`, a 16 már kész nyelv nyugtája és a további 10 indokoltan kimaradó nyelv. A `trial` csak az első videót készíti. A japán kép szemrevételezése és tulajdonosi jóváhagyás után küldhető az új renderelővel a három további nyelv. Annak folytatási próbahivatkozása a japán próbareceptre mutat, a japán archivált nyugta is a kész listában szerepel; a hét további nyelvhez valódi kész nyugta vagy indokolt kimaradás szükséges. Másik rendererrel készült régi próba nem jóváhagyás az új rendererhez.

Elutasított parancs: tartós `command_result`, `entity_id` a delivery_id, `result: {"ok": false, "error": "<határolt hibakód>"}`. Azonos delivery újraküldése nem írhatja felül az eredményt; javított recepthez új delivery_id kell, már regisztrált recept tartalma csak új verzióval módosítható.

## Telepítés és ellenőrzés

A szerverfrissítés külön háttérmunkában építi a checksum-ellenőrzött renderelő új képét, rögzíti a Docker image SHA-256 azonosítóját, és a gyártási zár szabad állapotában aktiválja a kezelőt. Nem küld próbát vagy sorozatot. Napló: `/var/log/kylo-ielts-trial-install.log`, egység: `kylo-ielts-font-renderer-prepare.service`. A végleges videóarchívum változatlan.

Az elkészült kód és a helyi szabálytesztek nem bizonyítják a VPS telepítését vagy a japán karakterek tényleges megjelenését; ehhez friss szerverjelentés és valódi VPS-es próba szükséges.