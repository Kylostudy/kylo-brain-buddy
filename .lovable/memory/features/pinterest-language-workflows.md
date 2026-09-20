---
name: Pinterest nyelvi workflow-k
description: Pinterest könyvtár — nyelvenként (nem IP-nként) egy workflow, a kylo.study 26 nyelvéhez, orosz kihagyva
type: feature
---

A Pinterest fiókok NYELVENKÉNT jönnek létre (a Reddit IP-nkénti mintától eltérően).
Forrás: kylo.study `src/i18n/locales/*.json` — 26 nyelv.

- Könyvtár: `workflow_folders` → „Pinterest" (brain modul).
- Névséma: `Pin <Nyelv magyarul> (<IP ország>)`, pl. „Pin Német (CH)".
- Angol = a meglévő „NL Pinterest" (NL IP-n, angolul) — ebbe a könyvtárba került.
- **Orosz kihagyva** (Oroszország mint piac kizárva).
- Nyelvek saját ország-IP nélkül a legközelebbi IP-re kerültek:
  cseh/szlovák/szlovén/horvát/román/szerb → HU, dán/svéd → FI, görög/arab → TR,
  hindi → SG, koreai → JP.
- spec: target_platform/platform `pinterest`, monitor_type `pinterest-account`,
  language, locale (`<lang>-<CC>`), proxy_id, account_label, start_url pinterest login.
