---
name: böngészőnyelv-szabályok IP-nként
description: Mely országokban mehet angol böngészőnyelv, hol marad a helyi nyelv; Hongkong angolul, kínai kizárva
type: design
---
Böngészőnyelv szabály (fingerprint.ts COUNTRY_LOCALE):
- Angol böngészőnyelv természetes: USA, GB, IE, CA, AU, NZ, SG, IN, IL + **Hongkong (en-HK)** — angol ott hivatalos nyelv. NL is angolul megy.
- Helyi nyelv marad: FR, IT, ES, PL, HU, TR, JP, TW (zh-TW), BR, MX, CO, AR, CL, KR, CH (de-CH), DE, AT, SE, DK, NO, FI, BE, PT, GR, SK, CZ, RO, SR...
- Hongkong döntés (2026-09-29): HK IP angol böngészővel megy, KÍNAIra NEM váltunk — Kína mint piac kizárva.
- TikTok/Instagram: Google Fordító kiegészítő TILOS (botjelnek veszik); Pinterest Live Browse-ban oké.
- Időzóna mindig az IP országához igazodik.
