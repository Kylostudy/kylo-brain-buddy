# Brain — malacperselyes reklámkészítő előkészítése a VPS-en

## Cél és jelenlegi állapot
A meglévő, működő VPS-videógyár mellé készíts új, elkülönített malacperselyes készítőt. Ebben a lépésben telepítés, önellenőrzés és technikai átadás történjen; NE indíts narrációt, videórendert, próbát, sorozatot vagy publikálást. A későbbi első próba pontosan egy magyar, 1080×1920-as videó lesz.

A mellékelt forrás **nem renderelt tervezet**, nem kész Docker-kép, nem telepítő és nem regisztrálható gyári manifest. A 39 másodperces jelenetidők becslések. A magyar hang után újra kell időzíteni őket; a későbbi nyelvsemleges alap hosszát a leghosszabb német narrációhoz kell igazítani.

## A csomag tartalma
- `source-draft/KyloPiggyBankMaster.tsx`: néma, szövegmentes animációterv.
- `source-draft/overlay-hu.json`: aktuális magyar felirat- és narrációterv.
- `brief.json`: jóváhagyott feltételek, nem végrehajtható recept.
- `test_brief.py`: nyolc előkészítő szabályteszt.
- `assets/kylo-dog.png`: a meglévő márkaanyag változatlan másolata.
- `forgatokonyv-v2.md`: a legfrissebb forgatókönyv.
- `CHECKSUMS.sha256`: átadott fájlok ellenőrzőösszegei.

## Pontos tartalmi feltételek
- Szemléltető kosár: 20 + 15 + 20 + 25 + 25 = 105 USD/hó. Számláló: 20 → 35 → 55 → 80 → 105.
- Végső nagy felirat: **„Több mint 100 USD/hó”**, nem kerek 100, nem túlzó összeg.
- A díjak nem ellenőrzött versenytársárak. Marad az olvasható „Szemléltető előfizetési kosár. A tényleges díjak eltérhetnek.” pontosítás. Nincs más alkalmazás neve/logója vagy garantált megtakarítási százalék.
- Kylo: **29,99 USD/hó**, tulajdonosi adat, nem lekért éles ár; publikálás előtt a csomag, számlázás és adófeltételek ellenőrzendők.
- CTA: **„Próbáld ki ingyen!”**, kiegészítés: **„14 napos ingyenes próba”**.
- Jegyzet → magyarázat → tanulókártya → gyakorlókérdés; nincs teljes funkciólista, biztos vizsgasiker vagy tévedhetetlenségi ígéret.
- A persely nem törik össze. Két külön márkazárás: megemelt arany kutya + CTA, majd normál kutyalogó fekete háttéren, `kylo.study`, `Your AI tutor`.

## Végrehajtandó feladat
1. Vizsgáld meg a tényleges VPS-gyárat és a működő, közös fontkészletes kiadásokat. Ne állítsd, hogy a forráscsomag már telepített vagy renderképes.
2. Nézd át a tervezet geometriáját, jelenethatárait, a `sceneFrames` bemenetet és a képfájl útvonalát. A jelenethossz-lista pontosan hét pozitív, véges egész szám legyen; hibás lista zárt hibával álljon le. A számláló és végösszeg időablaka ne fedje egymást. A pontosítás és CTA férjen a biztonságos publikálási zónába.
3. Készíts valódi konténeres belépési pontot a meglévő gyár szerződéséhez: `/request.json` csak olvasható kérés, `/recipe` checksum-ellenőrzött, csak olvasható input, `/work/output.mp4` kimenet. Ne használj távoli receptből futtatható kódot. A néma masterre külön helyi szöveg-/hangréteg kerüljön; Creatomate nem használható.
4. Készíts új, helyileg átvizsgált kiadást, javasolt azonosító `piggy-bank-safe-v1`, scene `piggy-bank-v1`. A tényleges Docker-kép teljes `sha256:` azonosítóját rögzítsd. Foglalt, eltérő azonosítót ne írj felül. A v2/v3/v4 vizsgakészítők megmaradnak.
5. Használd a már telepített, jóváhagyott közös fontokat; ne telepítsd őket újra szükségtelenül. Az új készítő a már meglévő izolált futtatási és médiavizsgálati szabályokat örökölje: hálózat nélkül, nem privilegizált felhasználóval, csak ideiglenes munkaterületre írva.
6. A helyi konfiguráció `renderers` térképéhez csak az új elemet add hozzá: tényleges image-digest, `reviewed: true`, pontos scene-lista. A feladatfogadó továbbra is ellenőrizze az aláírást, fájlméretet, checksumot, biztonságos útvonalat, nyugtát és tulajdonosi jóváhagyást.
7. Legyen kizárólag egy HU kimenetet engedő `malacpersely-hu-trial` próbarecept-támogatás (`series: "other"`); más nyelv, további kimenet vagy `start_series` ezzel a próbarecepttel legyen tiltott. Ha ehhez szűk, célzott szerződéskiegészítés kell, implementáld és teszteld; más sorozat szabályait ne lazítsd.
8. Dokumentáld a pontos inputfájllistát, a `text`, `subtitle`, `cta`, `audio`, `master` és `timing` mezők alakját és a támogatott scene-t. Egy sémapélda ne tartalmazzon kitalált hash-t, méretet vagy nyugtát, és ne legyen regisztrálható éles receptként feltüntetve. KyLogic csak ez alapján adhatja be a valódi hangot és adatokat.
9. Futtasd a nyolc brief-tesztet és az új készítő célzott tesztjeit: érvénytelen időzítés, hibás fájlútvonal, checksum, ismeretlen scene, többnyelvű/többkimenetes próba és sorozatindítás elutasítása; meglévő IELTS/Cambridge/Goethe regresszió. Futtasd a teljes meglévő önellenőrzést, render indítása nélkül.

## Megőrzés és költségek
Meglévő videó, narráció, archívum, nyugta, SQLite-állapot, konfiguráció és font változatlan maradjon. Gépi titkot ne változtass, ne naplózz és ne küldj vissza. Nincs új ElevenLabs-hívás vagy más fizetős szolgáltatás ebben a feladatban. Nincs sandboxrender vagy publikálás. Az új renderelhető forrást ellenőrzött helyi kiadásként telepítsd; ne az adatátadási csatornán keresztül telepíts programot.

## Kért teljesítési visszajelzés
Titkok nélkül add meg:
- új készítőazonosító, teljes tényleges image-digest és pontos scene;
- belépési pont és input-séma; egyetlen HU próba támogatása, sorozatindítás tiltása;
- célzott és regressziós tesztek darabszáma/eredménye;
- teljes önellenőrzés eredménye, friss VPS-életjel UTC-időpontja;
- eredeti videók, nyugták, régi készítők és fontok megőrzése;
- igazolás, hogy narráció, render, receptregisztráció és publikálás **nem indult**;
- a fennmaradó hibák külön, ne nevezz egy puszta buildet vizuálisan ellenőrzött videónak.

Sikeres visszaigazolás után KyLogic készíti elő az egyetlen magyar narrációt és a checksumos adat-receptet, majd külön elindítja a próbát. Csak az archivált és lejátszható próba megtekintése után jönnek további változatok.