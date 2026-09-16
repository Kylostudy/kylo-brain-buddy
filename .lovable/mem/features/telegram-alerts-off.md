---
name: Telegram értesítések kikapcsolva 2026-09-16
description: Minden kimenő Telegram riasztás globálisan letiltva (sendTelegram őrszem), Reddit lead-radar ingest is
type: constraint
---
2026-09-16-tól minden kimenő Telegram értesítés ki van kapcsolva:
`sendTelegram` (src/lib/reddit-post-patrol.server.ts) és a ui-recon saját küldője
azonnal visszatér, ha `TELEGRAM_ALERTS_DISABLED !== "0"` (alapból tiltva).
A lead-radar-ingest worker végpont is `disabled: true`-t ad, amíg
`REDDIT_MONITORING_DISABLED !== "0"`.

**Why:** stratégia-váltás + költség. A Reddit/subreddit figyelés (IELTS stb.)
nem hoz értéket. **How to apply:** ne kapcsold vissza kérés nélkül; a kód maradjon.
