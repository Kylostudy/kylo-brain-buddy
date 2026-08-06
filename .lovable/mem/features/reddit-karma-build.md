---
name: Reddit karma-építés
description: reddit_karma_build feladattípus — 5+ melegítési nap után napi 1–3 AI-írt, reklámmentes komment fiókonként, óránkénti cron
type: feature
---

- Feladattípus: `reddit_karma_build` (worker: `reddit-karma-build.js`).
- Feltétel: `warmup_days_completed >= 5` vagy `warmup_status = ready`.
- Fiókonként naponta 1 futás, benne max 1–3 komment, köztük min. 6 perc.
- A kommentet a Brain írja (`/api/public/worker/reddit-comment-draft`, Gemini Flash):
  rövid, konkrét, a poszt nyelvén, **link/márka/termék TILOS** — a szerver ki is szűri.
- Alkalmatlan poszt (politika, rant, NSFW, meta) → skip, nem kommentelünk.
- Cron: `schedule-reddit-karma-hourly`, óránként (perc 17), gazdi-ablak és helyi nappal figyelembe véve.
