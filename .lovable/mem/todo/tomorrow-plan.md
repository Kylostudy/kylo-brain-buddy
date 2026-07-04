---
name: tomorrow-plan
description: 2026-07-05-ös munkaterv — stealth plugin + holland warmup + LinkedIn/TikTok bemelegített workflow
type: feature
---

## Holnapi sorrend (2026-07-05)

### 1. Stealth plugin beépítése
- Cél: `bot.sannysoft.com` tesztek zöldre hozása.
- Mit javít: `navigator.webdriver = false`, valós `navigator.plugins` / `navigator.languages`, WebGL vendor randomizálás, Canvas/AudioContext fingerprint zaj, `window.chrome` runtime objektum, Permissions API.
- Eszköz: `playwright-extra` + `stealth plugin` (vagy `puppeteer-extra-stealth` ha az könnyebb).

### 2. Holland warmup modul (`warmup-nl`)
- Minden agresszív platformhoz (LinkedIn, TikTok, Facebook) kötelező login ELŐTT.
- 8–15 perc valódi böngészés: `nu.nl`, `telegraaf.nl`, `nos.nl`, `marktplaats.nl`, `google.nl` keresések, `youtube.nl`, `wikipedia.nl`.
- Emberi viselkedés: Poisson időzítés, scroll, véletlen misclick + javítás, kurzor jitter/overshoot.
- Cél: Brain maga generálja a cookie-kat és a fingerprintet — NEM Dolphinból hozzuk át (mert az másik fingerprint, és kidob a platform).
- Pinterest rövidebb (2–3 perc) vagy opcionális.

### 3. LinkedIn befejezése
- Stealth + warmup után belépünk LinkedInre.
- Módszer: jelszó + 2FA (TOTP kód a Bitwardenből), NEM Dolphin cookie-k.
- Cél: `kylo-study` (company ID 127334023) admin analytics elérése.

### 4. TikTok
- Ugyanez a módszer: stealth → warmup → jelszó + 2FA Bitwardenből.
- TikTok még szigorúbb fingerprint ellenőrzés mint LinkedIn — warmup még fontosabb.

## Amit NEM csinálunk holnap
- Dolphin → Brain cookie átvitel (ez megbukott, nem működik).
- Facebook / YouTube automatizált login (ezek kézzel mennek).
- Instagram (még nincs fiók).

## Elfogadott kockázatok
- Az első stealth + warmup próba lehet, hogy még nem tökéletes — ha a sannysoft még piros, tovább finomítjuk a fingerprintet.
- Ha LinkedIn/TikTok mégis kidob, nem nyomjuk tovább aznap (botgyanű-stop).
