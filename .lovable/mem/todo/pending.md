---
name: Függő feladatok
description: Még el nem végzett, de a felhasználó által megrendelt feladatok listája — beleértve a hosszú távú infrastruktúra fejlesztéseket is
type: feature
---

## Megcsinálandó

1. **Privacy Policy oldal** — a Brain publikus oldalához kell.
2. **Security / Trust oldal** — adatkezelési és biztonsági nyilatkozat.
3. **Magyar IP / proxy beszerzése** — a jelenlegi IPRoyal nem magyar; FB/TikTok HU fiókokhoz magyar lakossági IP kell. (Felhasználói feladat, nem fejlesztési.)
4. **Kai Logic ↔ Kylo Brain integráció** — lásd külön memória.
5. **Kubernetes VPS kezelés** — hosszú távú feladat: a recorder és egyéb szolgáltatások Kubernetes alapú orchestrációja a jelenlegi docker compose helyett/skálázhatóság érdekében.

## Háttér
- Felhasználónak van Amsterdam VPS-e, onnan IPRoyal ISP proxyval FB/TikTok login korábban működött.
- Jelenleg a videófeltöltést Kai Logic + GCS + AirShare csinálja; a Brain hivatott ezt kiváltani.
