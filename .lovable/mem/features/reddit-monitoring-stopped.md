---
name: Reddit stratégia-váltás 2026-08-31
description: IELTS/subreddit figyelés és Reddit Telegram-üzenetek leállítva; új irány: magyar fiók + béta tesztelő toborzás holtnyelvekre
type: feature
---
2026-08-31-től a Reddit figyelő rendszerek KIKAPCSOLVA (stratégia-váltás, nem hiba):
lead-radar cron, reddit-post-patrol, reddit-discourse, reddit-reply-digest és
reddit-reply-dispatch mind early-return `disabled` válasszal — a kód szándékosan
megmaradt, ne töröld és ne kapcsold vissza kérés nélkül.

Új stratégia: a magyar Reddit fiókon posztolunk; ~100 béta tesztelő keresése
minden holtnyelvre és nagyon ritka nyelvre (összesen kb. 1600–2000 béta hely).
Cél: blow-off marketinggel ~1000 fizető user. **Why:** gazdái döntés. **How to apply:**
Reddit Telegram-riasztást vagy IELTS/subreddit figyelést ne indíts újra, csak ha kéri.
