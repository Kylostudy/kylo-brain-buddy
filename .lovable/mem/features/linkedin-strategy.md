---
name: LinkedIn stratégia
description: LinkedIn a kiemelt platform — heti 2 poszt (kedd/csütörtök), idegen posztok alatti hozzászólás jóváhagyással, melegítés
type: feature
---

- **Prioritás:** a LinkedIn az elsődleges csatorna (a Reddit mellett).
- **Posztolás:** hetente kétszer, kedden és csütörtökön.
- **Idegen posztok (`linkedin_engage_scan`):** 3 óránként körbenéz a hírfolyamban
  és IELTS/TOEFL/EdTech/nyelvtanulás kulcsszavakon. Gemini pontoz (60 pont felett
  javasol), MAGYAR hozzászólás-javaslatot ír, Telegramra megy `🟣 LINKEDIN JAVASLAT`.
- **Jóváhagyás:** ugyanaz a nyelv, mint a Redditnél — „mehet” = kimegy angolul,
  saját magyar szöveg = lefordítjuk, „nem” = kihagyjuk. **Automatikusan SOHA nem
  kommentelünk.** A kitevés a `linkedin_comment_post` feladat, körönként max 2 db.
- **Zajszűrés:** profilmegtekintés, „ismerheted”, hírajánló nem megy Telegramra;
  a megjelenítés-szám (`impressions`) a `linkedin_post_metrics` táblába kerül.
- **Melegítés:** a profilt folyamatosan melegíteni kell (böngészés, olvasás),
  nem csak posztoláskor aktív.
