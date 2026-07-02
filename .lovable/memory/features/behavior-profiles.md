---
name: Behavior profiles
description: Minden jelenlegi workflow humanized (Brain). Audit/robot módot később aktiváljuk. humanize.js a közös modul.
type: feature
---

# Jelenlegi állapot (2026-07)

MINDEN jelenlegi workflow humanized viselkedést használ, akár Brain, akár Audit modulhoz tartozik:
- `worker/executor/scripts/humanize.js` — közös modul (Poisson wait, Bezier egér, jitter, overshoot, misclick, lognormális gépelés, elgépelés)
- `worker/executor/scripts/tiktok.js` — humanized (Brain)
- `worker/executor/scripts/decathlon-stock.js` — humanized (Audit, DE most Brain-típusú viselkedéssel, mert éles TikTok/FB fiókokat is fog majd tesztelni ugyanez az infra)
- `worker/executor/scripts/bot-smoke-test.js` — humanized, cél: bot.sannysoft.com + CreepJS smoke test

# Miért Decathlon is humanized

A user rendelkezése: "a Brainben akartam beállítani. A botot majd egy kicsit később fogjuk beállítani, mert azt a kylopon study oldal tesztelésére hoztam létre".
Tehát a determinisztikus robot mód a KyloPon Study tesztelésére van fenntartva, arra amikor tudatosan bot akarunk lenni. Az összes többi (beleértve a Decathlon-t is) Brain-típusú.

# TODO — Robot mód (később)

- `worker/executor/scripts/robot.js` — determinisztikus, gyors, hibamentes viselkedésmodul
- Workflow spec-ben `behavior: "human" | "robot"` mező, alap "human"
- Csak akkor kapcsoljuk aktívra, amikor a KyloPon Study tesztelés indul

# Szabály

Új workflow-t úgy hozz létre, hogy alap-viselkedés a humanize.js. Robot módra csak explicit workflow spec kapcsolón át válts.
