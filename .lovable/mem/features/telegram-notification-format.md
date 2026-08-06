---
name: Telegram értesítés formátum
description: Minden Telegram értesítés fejlécében platform + subreddit/felület + saját fiók; a "nem kell válasz" esetek is kimennek, felülbírálható
type: feature
---

Minden kimenő Telegram üzenet első sora azonosító fejléc:
`🟠 REDDIT · r/<subreddit> · fiók: u/<sajat_fiok>` (LinkedIn/egyéb platformnál ugyanígy a platform neve).

Szabályok:
- A válasz mindig **reply** az adott üzenetbuborékra (Telegram reply), így egyértelmű, mire vonatkozik; a rendszer a `telegram_message_id` alapján párosít.
- Azok a kommentek is kimennek, amiknél az AI szerint NEM kell válasz — `⚪` jelöléssel és rövid indoklással. A felhasználó felülbírálhatja: ha mégis válaszol a buborékra, a válasz lefordítódik és jóváhagyottként mentődik.
- Visszaigazoló üzenet is tartalmazza az azonosító fejlécet (platform + subreddit + kommentelő).
