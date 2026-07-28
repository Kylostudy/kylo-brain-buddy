---
name: Warmup fogalmak — Reddit warmup vs. proxy sütigyűjtés
description: A "Reddit warmup" a Reddit fiók emberi böngészéssel való bemelegítése, NEM a proxy szintű sütigyűjtés. Két külön dolog.
type: preference
---

A felhasználó két teljesen külön dolgot ért ezeken — soha ne keverd őket:

**1. „Reddit warmup"** = a MEGLÉVŐ Reddit fiók bemelegítése.
- Bejelentkezve a Redditen: görgetés, upvote-olás, posztok olvasása, subreddit nézelődés, emberi mozgás szimuláció.
- Azokon a workflow-kon fut, ahol MÁR VAN Reddit accountunk (angol nyelvűek + holland, USA kivételével).
- Ez a `reddit_accounts` / `reddit_warmup_log` rendszer.

**2. „Országonkénti warmup" / „sütigyűjtés"** = kijelentkezett, civil böngészés az adott ország proxyján.
- Célja: süticsomag + proxy megjáratás, hogy utána REGISZTRÁLNI tudjunk.
- Ez a `logged-out-warmup.js`.

**Fő cél / prioritás:** az összes olyan országnál, ahol még NINCS Reddit account, el kell jutni oda,
hogy tudjunk Reddit fiókot regisztrálni. Ez sürgős. A sütigyűjtés csak eszköz ehhez, nem cél.
