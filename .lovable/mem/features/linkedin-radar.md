---
name: LinkedIn radar
description: LinkedIn értesítés- és kommentfigyelő ugyanazzal a magyar Telegram-logikával, mint a Reddit érdeklődés-radar
type: feature
---

A `linkedin_comment_scan` brain task bejelentkezve (mentett sütikkel) beolvassa
a LinkedIn értesítéseket és a saját posztok alatti hozzászólásokat, majd
beküldi a Brainnek (`/api/public/worker/linkedin-comment-ingest`).

A Brain Geminivel magyarra fordít, MAGYAR válaszjavaslatot ír, és Telegramra küld
`🔵 LINKEDIN · …` fejléccel (ha nem kell válasz: `⚪`). A válasz ugyanaz a nyelv,
mint a Redditnél: „mehet/ok” = javaslat elfogadása, saját magyar szöveg = fordítás,
„nem/skip” = kihagyás, kérdés = visszakérdezés. Tárolás: `linkedin_comments` tábla.
Semmit nem posztol ki automatikusan.
