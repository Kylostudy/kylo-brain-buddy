---
name: Headed böngésző mód (executor)
description: Az executor headed Chromiumot futtat Xvfb virtuális kijelzőn; headless csak vészfallback (EXECUTOR_HEADLESS=1)
type: feature
---

# Miért

A headless Chrome a legerősebb botjel (CreepJS "headless 100%"), emiatt
Pinterest/Facebook/Cloudflare bejelentkezési hurokba tesz. A recorder eddig is
headed volt Xvfb alatt — az executor mostantól ugyanaz.

# Hogyan

- `worker/executor/scripts/display.js` — `ensureVirtualDisplay()` (Xvfb :99),
  ha nem indul, headlessre esünk vissza, a futás nem hal meg.
- `worker/executor/run.js` — `headless` = `EXECUTOR_HEADLESS === "1"` vagy nincs kijelző.
  Extra flagek: `--disable-infobars`, `--no-first-run`, `--no-default-browser-check`,
  `--disable-features=AutomationControlled,Translate`, `--window-size` a fingerprint viewportból.
- `worker/Dockerfile` — xvfb, xauth, x11-utils + `ENV DISPLAY=:99`.
- `worker/orchestrator/index.js` — `--shm-size 1g` (EXECUTOR_SHM_SIZE), `EXECUTOR_HEADLESS` átadva.
- UA fallback Windows Chrome (a fingerprint platform is Win32 — nem térhetnek el).

# Ellenőrzés

„Bot smoke teszt" workflow (id 847670c3-2f96-4ba9-8233-b3bce6890739) —
bot.sannysoft.com + CreepJS. Új worker-deploy után ezt kell lefuttatni az adott
proxyval, és a CreepJS `headless_pct` értéknek alacsonynak kell lennie.
