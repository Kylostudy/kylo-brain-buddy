## A lényeg

A `Kylo Sign Up` workflow-t **nem másoljuk le**. Ami hetekig fájt, az a motor volt (felvétel → visszajátszás → proxy → riport), és az most stabil. Ha másolgatjuk, minden másolatban külön romlik el.

Helyette: **a motor egy darab marad, a tesztek adatok lesznek.** Új funkció tesztelése ezután felvétel + elnevezés, nem kódolás, nem `git pull`, nem VPS build.

## Amit építünk

**1. Teszt-forgatókönyv tár**
Minden kis teszt egy sor az adatbázisban: név, funkció-címke (pl. „olvasónapló"), lépéslista, elvárások, nyelvvizsga-dimenzió. A meglévő signup flow lesz az első ilyen forgatókönyv — átalakítjuk, nem duplikáljuk.

**2. Építőkocka-készlet (közös előjátékok)**
Bejelentkezés, előfizetés bekapcsolása, nyelvvizsga kiválasztása, navigálás egy modulba. Egyszer vesszük fel, utána bármelyik teszt elé bepipálható. Így az olvasónapló-teszt nem rögzíti újra a belépést.

**3. Kétféle létrehozás (a válaszod szerint mindkettő)**
- *Felveszem*: végigkattintom a funkciót, rögzül, elnevezem.
- *Összerakom*: kockákból kattintom össze.
- A felvett lépéslista utólag szerkeszthető, sorok törölhetők/átnevezhetők.

**4. Kettős Gemini-ellenőrzés**
- **A) Megfigyelő**: mit adott ki a Kylo (feladat, javítás, magyarázat) — képernyőkép + kiolvasott szöveg alapján leírja, mi történt.
- **B) Bíró**: külön, független hívás. Csak a feladatot és a Kylo válaszát kapja meg, az A) véleményét NEM. Ítél: helyes-e, releváns-e, jó nyelvi szinten van-e. Pontszám + indoklás.
Így nem tudja magát felmenteni a rendszer.

**5. Nyelvvizsga-mátrix**
A vizsgatípus nem külön teszt, hanem dimenzió. Egy forgatókönyv opcionálisan végigfut az összes vizsgán, és a riport mátrixban mutatja: vizsga × funkció → zöld/piros. Ezzel a dinamikus menü is tesztelve lesz: rögzítjük, melyik vizsgánál mely funkcióknak KELL megjelennie, és eltérésnél hibát jelez.

**6. Riport**
Forgatókönyvenként: lépések, képernyőképek, bírói pontszám, nyelvi ellenőrzés, proxy/ország. Fölötte összesítő mátrix.

## Sorrend

1. Adatbázis: forgatókönyvek, építőkockák, vizsga-mátrix táblák.
2. Felület `/audit/scenarios` alatt: lista, felvétel, kockákból építés, szerkesztés, indítás.
3. A signup flow átemelése első forgatókönyvnek (bizonyíték, hogy a motor változatlanul jó).
4. Kettős Gemini bíró bekötése.
5. Első új teszt: **olvasónapló** — végigkattintva, bíróval.
6. Vizsga-mátrix bekapcsolása.

## Technikai megjegyzés

A worker oldalon a `record-replay` motor és az orchestrator **nem változik** — csak a rá küldött feladat-leírás lesz általánosabb (forgatókönyv-azonosító + lépések + elvárások). Így nem kell VPS-t újraépíteni minden új teszthez; a VPS-en futó kód ugyanaz marad, csak más adatot kap. Ez oldja meg azt, amitől tartasz: nem fordulhat elő újra, hogy egy új workflow miatt egy napot a motorral kell küzdeni.

## Egy nyitott kérdés

A nyelvvizsga-típusok pontos listája (hány darab, mi a nevük) — ezt még megadod, addig a mátrixot úgy építem, hogy a felületen te tudod felvenni őket.
