---
name: IELTS folytatás — csak 11 nyelv gyártható
description: Tulajdonosi szabály (2026-10-24): IELTS folytatásban csak AR, DA, HI, JA, KO, RU, SK, SL, SR, SV, TR gyártható; a többi 16 kész, az EN/RO/HR/EL példányok csak archiválandók; gyártás csak kifejezett KyLogic-feladatra.
type: constraint
---

# IELTS folytatás — csak 11 nyelv gyártható

Tulajdonosi utasítás (2026-10-24):

- Sorozatgyártás TILOS. Gyártani kizárólag ezt a 11 nyelvet szabad: **AR, DA, HI, JA, KO, RU, SK, SL, SR, SV, TR**.
- A többi 16 nyelv kész (DE, EL, EN, ES, FI, FR, HR, HU, IT, NL, NO, PL, PT, RO, ZH, CS) — ezeket újragyártani tilos.
- Az EN, RO, HR, EL kész videók a `ielts-vps-folytatas-meglevo-anyagok-v1.zip` csomagban érkeztek: csak ellenőrzés és kizárólagos (no-overwrite) VPS-archiválás, sosem újrarenderelés.
- Gyártás csak akkor indulhat, ha a KyLogic kifejezetten erre a 11 nyelvre küld folytatási feladatot.
- A 11 nyelv hangja eredeti ElevenLabs-felvétel (új TTS tilos); a szövegek és időzítések a history JSON-okban vannak.
- Kódoldali védelem: `infra/video-factory/contract.py` `CONTINUATION_LANGUAGES` — a folytatási recept nyelvkészlete pontosan ez a 11 kell legyen, különben `continuation_languages_restricted` hibával elutasítva.
