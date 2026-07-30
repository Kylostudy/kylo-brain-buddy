---
name: esti-fejlesztoi-mod
description: Élő szkript-becsatolás (build nélküli gyors teszt) a workeren, 17:00–08:00 idősávban, live.sh kapcsolóval — ideiglenes megoldás a Kubernetes-átállásig.
type: feature
---
A workeren van egy "esti fejlesztői mód": az executor konténer a VPS
fájlrendszeréről olvassa a `run.js`-t és a `scripts/` mappát (read-only),
így `git pull` után azonnal az új kód fut, Docker build nélkül.

- Kapcsoló: `worker/live.sh on|off|auto|status`, beállítás: `LIVE_MODE`, `LIVE_WINDOW` (alap 17:00-08:00, Europe/Budapest).
- Csak `run.js` + `scripts/` élő; node_modules/Playwright marad az image-ből → csomagváltozásnál teljes blue-green build.
- Indítás előtt kötelező `node --check`; hiba esetén automatikus visszaesés az image-re, `sync-scripts.sh` hibánál git reset.
- `deploy.sh` maga dönt: csak szkript-változás + aktív élő mód → gyors szinkron; minden más → blue-green.
- Ez ideiglenes: kb. 2 hónapon belül Kubernetes-re állunk át, és a mostani rendszer új, erős vasra költözik.
