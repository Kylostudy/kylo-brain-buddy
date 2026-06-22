---
name: Kai Logic integráció terv
description: Hogyan kapcsoljuk be a Kai Logic-ot a Core Hub / Brain ökoszisztémába
type: feature
---

## Kiindulás
- Kai Logic = meglévő, komplex rendszer, jelenleg GCS + AirShare-en keresztül tölt videókat FB/TikTok/YouTube-ra.
- Saját tenant-kezelése van (régebbi, mint a Brain/Audit/Core Hub közös tenant modellje).
- Nincs Core Hub elé kötve, nincsenek meg a dupla biztonsági + task csatornák (hub ↔ brain).
- Három alap előfizetésből áll, sok kombinációval.

## Cél
Az AirShare-es feltöltést a Kylo Brain recorder + session-alapú login váltsa ki.

## Javasolt lépéssorrend (megbeszélendő)
1. Kai Logic bekötése a Core Hubba (auth, tenant, task-csatornák, log-csatornák).
2. Kai Logic tenant-rendszerének összehangolása a Core Hub tenant-jaival (mapping vagy migráció).
3. Kai Logic ↔ Brain task-csatorna (Brain kapja a feltöltési feladatokat, nem az AirShare).
4. Session/cookie-import flow a Brainbe (FB/TikTok/YouTube).
5. Videófeltöltés workflow felvétele a recorderrel.
6. AirShare fokozatos kivezetése.
