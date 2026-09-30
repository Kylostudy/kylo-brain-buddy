# Stabil, platformonként elkülönített közösségi fiókok

## Cél
A Facebook, Instagram, TikTok és Pinterest minden fiókja csak a saját platformjának és saját munkafolyamatának belépési állapotát használja. Az IP, nyelv, időzóna és böngészőazonosság ne mondjon ellent egymásnak.

## Megvalósítás
1. **Platformok teljes szétválasztása**
   - Megszüntetem az ország alapján más munkafolyamatból átvett sütiket.
   - A futtató és az élő böngészés csak a célplatformhoz tartozó adatot fogadhat el; eltérésnél inkább álljon le, ne használjon másik platformot.
   - A Facebook belépését csak akkor tekintjük sikeresnek, ha mindkét szükséges Facebook-süti jelen van.

2. **Tartós fiókállapot**
   - Minden munkafolyamat külön, tartós böngészőprofilt kap a worker gépen.
   - Az élő böngészés újranyitáskor ugyanazt a profilt használja, így a sütiken kívüli helyi állapot sem vész el.
   - A profilkönyvtár neve csak belső, ellenőrzött azonosítóból készül; egyidejű megnyitását tiltjuk.

3. **Egységes böngészőazonosság**
   - Megszüntetem a Windows/Mac/Linux véletlenszerű keverését, és egyetlen stabil, a tényleges workerhez illő gépazonosságot használok.
   - Az IP országa határozza meg az időzónát; a munkafolyamat nyelve csak akkor írhatja felül a böngésző nyelvét, ha ez előre megadott és következetes.
   - A Facebook magyar munkafolyamatainál Budapest időzónát rögzítek; ellenőrzöm az Instagram és TikTok IP-hozzárendeléseket is.

4. **Meglévő adatok rendezése és ellenőrzés**
   - Kijavítom a hibás vagy hiányzó platform–IP–nyelv–időzóna párosításokat az adatbázisban.
   - A régi, bizonytalan eredetű platformközi sütiket nem másolom tovább.
   - Ellenőrzöm a kódot, a friss összeállítást és az érintett munkafolyamatok beállításait.

## Biztonsági határ
Nem építek CAPTCHA-megkerülést. A cél a stabil, saját fiókhoz kötött környezet és a normál kézi ellenőrzések megtartása.

## Technikai részletek
- Az egyediség továbbra is munkafolyamat + platform páron marad.
- A tartós profilokat a recorder kezeli; a központi rendszerbe csak titkosított belépési adatok kerülnek.
- A Pinterest Fordító-kiegészítője megmarad, de ugyanazt a tartós Pinterest-profilt használja.
