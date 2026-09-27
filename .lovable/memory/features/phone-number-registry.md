---
name: Telefonszám-nyilvántartás és automatikus feltöltés
description: 12 angol nyelvterületi prepaid PS Yugo szám — nyilvántartás menüpont a Brainbe, lejáratfigyelés, automatikus kártyás feltöltés 5 nappal lejárat előtt, csatorna/email/fiók hozzárendelés
type: feature
---

# Telefonszám-nyilvántartás és automatikus feltöltés — megbeszélt terv

Állapot: ötletfázis, kidolgozás 2-3 napon belül (beszélgettünk róla, kódolás tilos volt még).

## Háttér
- 12 darab prepaid "PS Yugo" szám lesz az angol nyelvterületi IP-khez (eSIM-stratégia memória).
- Minden számhoz IP + süticsomag + fiókok (Gmail, TikTok, Instagram, stb.) tartoznak.
- Ha egy szám elvész, vele együtt a Gmail és az összes fiók — ezért komolyan kezelendő.

## Megbeszélt terv (user jóváhagyta az irányt)
1. **Külön menüpont a Brainbe** — szám nyilvántartás:
   - telefonszám, ország, szolgáltató
   - melyik IP-hez tartozik, milyen csatornák/fiókok lógnak rajta (melyik email, melyik TikTok, melyik Instagram)
   - utolsó feltöltés dátuma és összege
   - érvényességi idő napokban (szolgáltató feltételei szerint) → kiszámolt lejárat napja, jól láthatóan
2. **Automatikus feltöltés**: előre megadott kártyaadatokkal, a lejárat előtt kb. 5 nappal a rendszer feltölti a számot egy beállított összeggel, és a feltöltés után automatikusan frissíti a következő lejáratot (ugyanannyi idővel, mint az előző kör).
3. **Biztonság**: a kártyaadatok csak titkosítva tárolódnak; a robot-alkalmat előbb csak "futtatás" gombbal, kézi jóváhagyással indítjuk, később automatizálható.
4. **Biztosíték**: naponta egyszer ellenőrzés — mi történik, ha a feltöltés elakad (kártya lejár, szolgáltató oldala megváltozott): Telegram figyelmeztetés + a számnak "probléma" jelző.
5. **Szolgáltatói oldalon is elmentve** a szám — a szolgáltató fiók a tartalék, ha a rendszerből kikerül az adat.
6. **Tevékenység-elszámolás**: ha a számnak kötelező tevékenység van (SMS/hívás X naponta), azt is rögzítjük és emlékeztetünk rá.

## Szolgáltatói feltételek feldolgozása
- A user minden szolgáltató ÁSZF-jét feltölti a Geminibe (vagy más feldolgozónak), és számonként rákérdez a lejárati dátumra és feltételekre.
- User megadja egyenként a pontos szolgáltatókat, itt beszéljük meg mindet.
- **Döntés (user jóváhagyta)**: a teljes ÁSZF-et NEM tároljuk szolgáltatónként — csak a belőle kinyert adatokat (lejárat, feltételek, korlátok) + rövid forráshivatkozást. A felállás véglegesíttetett.

## Nyitott kérdések
- Melyik szolgáltató(k)től lesznek a számok? Ugyanaz minden számhoz, vagy országonként eltérő?
- Van-e automatikus megújítás a szolgáltatóknál?
- Ez határozza meg: elég a nyilvántartás + emlékeztető, vagy kell a feltöltő robot is.
