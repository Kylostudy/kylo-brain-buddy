---
name: Instagram–TikTok ütközésvédelem és poszt-visszaigazolás
description: Instagram és TikTok futás sosem mehet egyszerre (bármely IP alatt); minden kiküldött posztról jön Telegram visszaigazolás
type: feature
---

1. **Instagram / TikTok kizárás**: a worker claim endpoint (`src/routes/api/public/worker/claim.ts`) nem ad ki Instagram vagy TikTok futást, amíg fut egy másik Instagram/TikTok futás — bármely proxy/IP alatt. Cél: soha ne menjen ki egyszerre (pláne ugyanaz) videó a két platformra. Minden jövőbeli IP-re automatikusan érvényes.

2. **Poszt-visszaigazolás Telegramon**: minden Tartalom Stúdióból indított poszt (van `brain_task.draft_id`) végén a `complete` endpoint Telegram üzenetet küld: platform + célfelület + siker/hiba + cím + link. Ez a jövőben is maradjon így — a néma rendszer elfogadhatatlan, mert a Reddit gyorsválasz-lehetőség elveszne.
