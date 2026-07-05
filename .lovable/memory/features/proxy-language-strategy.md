---
name: proxy-language-strategy
description: Végleges proxy → nyelv/ország kiosztás. 12 proxy, 28 (proxy_id, language) profil. Első fázisban csak angol + német régiók indulnak.
type: feature
---

# Proxy → nyelv/ország stratégia (VÉGLEGES)

## Kulcs elv
- Egy proxy = egy IP, de több `(proxy_id, language)` profil ülhet rajta.
- Minden profil saját cookie jar-t, fingerprintet, warmup-ot kap.
- Egy profilon 3 platform account fut párhuzamosan: TikTok, Instagram, Pinterest.

## 12 proxy, 28 profil

| # | Proxy | Nyelvek/locale |
|---|---|---|
| 1 | CH (Svájc) | de-CH, de-DE, de-AT, fr-FR, it-IT |
| 2 | ES (Spanyolo.) | es-ES, pt-PT |
| 3 | HU (Magyaro.) | hu, sk, cs, sl, hr, ro |
| 4 | PL (Lengyelo.) | pl, uk |
| 5 | SE (Svédo.) | sv, da, no, fi |
| 6 | GB (UK/London) | en-GB, en-IE |
| 7 | NL (Hollandia) | nl, nl-BE |
| 8 | USA | en-US |
| 9 | CA (Kanada) | en-CA, fr-CA |
| 10 | AU (Ausztrália) | en-AU, en-NZ |
| 11 | MX (Mexikó) | es-MX, es-CO, es-CU, es-CL |
| 12 | BR (Brazília) | pt-BR |

**Warmup workflow összesen: 28.** Ebből account-onként (TikTok/Instagram/Pinterest) 3× másolat → 84 üzemi workflow.

## Döntési indoklás
- **Olaszország CH-n**: Ticino kanton hivatalosan olasz nyelvű, védhető.
- **Franciaország CH-n**: francia szintén hivatalos svájci nyelv.
- **Chile MX-en**: spanyol nyelv fontosabb, mint az időzóna-egyezés.
- **Finnország SE-n**: gazdasági-földrajzi értelemben Skandinávia, bár finnugor nyelv.
- **Kanada `fr-CA`**: Québec miatt életszerű.
- **Új-Zéland AU-n**: kicsi ország, sok AU-NZ kereskedelmi kapcsolat.
- **USA csak `en-US`**: japán/arab/indiai/izraeli NEM mehet USA IP-ről (fingerprint-mismatch).

## Későbbre halasztva (saját proxy kell)
- Franciaország saját FR proxy (ha kinövi CH-t)
- Japán, Korea, Vietnám, Thaiföld, Kína (Kína: csak Reddit)
- Izrael, arab országok, Törökország
- Oroszország, Belarusz (csak Reddit, szankciók miatt nincs videó)
- India
- Balti államok (lt, lv, et), Izland
- Afrika (arab + francia + angol – kontinens-specifikus)
- Spanyol dél-amerikai bővítés: es-AR, es-PE, es-EC, es-VE

## Indulási ütemterv
- **Aug 15**: oktatási ökoszisztéma indul.
- **Aug 15 – szeptember**: csak angol + német régiók publikálnak.
  - 5 proxy: USA, GB, CA, AU, CH
  - 9 profil: en-US, en-GB, en-IE, en-CA, en-AU, en-NZ, de-CH, de-DE, de-AT
- A többi 19 profil warmup-ban létezik, de nem publikál.
- Új proxy vásárlás CSAK akkor, ha a jelenlegi 12 proxy teljes infrastruktúrája fel van töltve.

## Belarusz + orosz
Kihagyva videós platformról szankciók + platform-szigor miatt. Reddit-en fogunk oda menni.
