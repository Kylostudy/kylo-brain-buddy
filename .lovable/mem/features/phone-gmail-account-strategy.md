---
name: Telefonszám és Gmail fiókgyártási stratégia
description: eSIM-alapú telefonszámok IP-nként, Gmail fiókok proxynként, majd TikTok/Instagram/Pinterest fiókok fokozatos melegítése
type: feature
---

Sorrend és szabályok (a nyitás utáni bevételtől függően, lassan felfutva):

1. **Telefonszám = azonosító.** A Google IP + telefonszám alapján azonosít, ezért
   **IP-címenként külön eSIM/telefonszám** kell. Ugyanaz a szám nem használható
   több proxyhoz.
2. **eSIM-vásárlás csak pénzből**: amint van rá keret, indul a beszerzés.
   Ha szűk a keret, először a 9 „első fázisú" ország (US, GB, CA, AU, IE, NZ,
   CH/DE/AT), a többi ráér.
3. **Gmail workflow mind a 22 IP-hez** — külön workflow, saját süti-csomaggal,
   hogy a Google ne hisztizzen minden belépésnél.
4. A Gmail fiókok megléte után jönnek sorban: **TikTok → Instagram → Pinterest**
   fiókok, IP-nként, mindig a hozzá tartozó Gmaillel és proxyval.
5. Minden újonnan létrehozott fiók **melegítés** alá kerül (nézelődés, görgetés,
   alkalmi interakció), publikálás csak érett fióknál.
6. **Tempó:** kb. 6 hét felfutás. Nem sietünk — a lebukás kockázata a tempóból
   és a telefonszámok fenntartásának hiányából jön, nem a stratégiából.
7. A telefonszámokat **fenn kell tartani** (aktív előfizetés), különben a Google
   újra-verifikációt kér és elveszik a fiók.

Külön magyar IP-s workflow kell **Facebookhoz** és **YouTube-hoz** (két külön
workflow).
