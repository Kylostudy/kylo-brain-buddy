---
name: Napi Reddit fiók-melegítés
description: Minden aktív Reddit fiók naponta egyszer, véletlen időpontban bemelegszik; az ütemezés az adatbázisban él, VPS újraépítés után is fut
type: feature
---

Minden `reddit_accounts` sor (status=active) **naponta egyszer** kap egy bemelegítő futást.

- Ütemező: `pg_cron` „schedule-reddit-warmups" job, óránként hívja
  `/api/public/cron/schedule-reddit-warmups`.
- Az ütemezés az adatbázisban él (brain_workflow_runs sorok), ezért a VPS
  újraépítése/újraindítása **nem törli** — a worker a claim endpointon felveszi.
- Mintakerülés: aktív óra 06–21 UTC, óránként 35% indítási esély, 22–40 perc
  véletlen hossz.
- Egy fiókon min. 20 óra szünet két bemelegítés között; sikertelen futás után
  1 óra múlva újrapróbálkozik (így rebuild után magától folytatódik).
- A futás a `reddit_warmup` brain task: belépés sütivel/jelszóval, görgetés,
  poszt olvasás, alkalmi upvote — **soha nem posztol**.

Jelenlegi fiókok: CA, GB, NL, SG, NZ, US, HU.
