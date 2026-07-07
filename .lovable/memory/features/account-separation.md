---
name: account-separation
description: Brain-only accountok szabálya. A user személyes profiljai SOHA nem futnak a VPS-en. Facebook admin: Kovács László profil, saját HU telefonszámmal (nem a useré).
type: constraint
---

# Account szétválasztás — Brain-only profilok

## Alapszabály
A user személyesen használt social media accountjai SOHA nem kerülhetnek a Brain-be / VPS-re. Minden platformon külön "Brain-only" account kell, amit a user fizikailag soha nem használ a saját géped böngészőjéből.

**Miért:** ha ugyanaz az account egyszerre két IP-ről / két böngészőből aktív (user otthonról + Brain a VPS-ről), akkor:
- Facebook / Instagram: azonnal kidobja mindkét sessiont, "gyanús aktivitás" flag → jelszó reset, 2FA lock
- TikTok: shadowban vagy device-check
- LinkedIn: "unusual sign-in" email, esetleg fiók-zár

## Jelenlegi állapot platform-onként (2026-07-07)

| Platform | User saját account | Brain-only account | Megjegyzés |
|---|---|---|---|
| **Facebook** | Van (feketelistás) | **Kovács László** profil, HU proxy | Két hónapja küzd a userék a platformmal. A Kovács László admin lesz Kylo összes FB oldalán (kb. 24-26 nyelv). |
| **LinkedIn** | Nincs használatban | Kylo LinkedIn, NL proxy | User nem használja személyesen, csak Kylo miatt lett létrehozva |
| **TikTok** | **Nincs is** személyes | Kylo TikTok accountok | User nem is akar személyes TikTok-ot — párhuzamos session probléma eleve nem játszik |
| **Instagram** | **Nincs is** személyes | Kylo Instagram accountok | Ugyanaz, mint TikTok — nem játszik a párhuzamosság |
| **Pinterest** | ? | Kylo Pinterest accountok | Egyeztetni |
| **Reddit** | ? | 11 nyelvű Kylo account | Külön kezelendő (reddit-story-monitoring memória) |

## Kovács László Facebook profil — technikai követelmények
- **Külön telefonszám a 2FA-hoz** — másik magyar szám, NEM a user személyes száma (fontos: ha valaha a saját számra SMS jönne, a Facebook összeköthetné a két accountot)
- **Saját cookie jar** a `cookie-jar-badge` rendszerben
- **Külön fingerprint** — más User-Agent, más locale+timezone kombináció mint a user otthoni Facebookja
- **HU proxy** (proxy-language-strategy szerint)
- **Egyetlen admin account az összes HU Kylo Facebook oldalhoz** — a Kovács László profil admin lesz mind a ~24-26 nyelvű Kylo oldalon (nem 24-26 külön profil, hanem 1 profil sok oldal admin joggal)

## Warmup logika a Brain-only accountokra
Amint egy Brain-only account cookie-val bekötésre kerül, a warmup workflow-t
bejelentkezett módra kell állítani (nem a jelenlegi `logged-out-warmup.js`).
- **Csak saját nyelv / IP** — HU account HU proxy-ról HU tartalmat néz
- **Fokozatos ébresztés** — első 1-2 hét csak scroll+like+néha save, semmi post/komment
- **Napi 15-30 perc, nem 3 óra** — valódi user is így használja
- **Emberi viselkedés kötelező** (human-behavior memória)
- **Feltöltés csak warmup után** kezdődik

## Kivételek
- **A user saját Facebookja feketelistás** — semmiképp ne érjük hozzá a Brain-nel
- **Reddit** külön szabályok (read-only, lásd reddit-story-monitoring)
