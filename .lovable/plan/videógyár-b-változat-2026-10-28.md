# Videógyár „B” változat

## Cél

A KyLogic egyetlen jóváhagyott paranccsal tudjon vizsgavideó-sorozatot készíttetni, ellenőrizni és folytatni a VPS-en. Új vizsganév, pontozás, felirat vagy szín csak adatcsomagot igényeljen; Brain-frissítés csak új vizuális videótípushoz kelljen.

**Ebben az átadásban nem indul gyártás, új hangkészítés vagy közösségi közzététel.** A meglévő videók, receptek, nyugták és archívum változatlanul megmaradnak.

## 1. Egy közös vizsgavideó-sablon

- Külön új változat: `exam-promo-universal-v1`, a már ellenőrzött videókészítő védelmeire építve.
- Vizsganév, részvizsgák, példák, időkeretek, pontozás, szókártyák, színek, betűk, CTA és Telegram-cím szigorúan ellenőrzött adatokból jönnek. A vizsganév nem fordul le.
- IELTS és Cambridge új adatprofilokat kap; a régi recepteket továbbra is a régi készítőjük olvassa, átalakítás és újragyártás nélkül.
- Új vizsgát vagy nyelvet nem tilt név szerinti lista. Hibás adatnál a hiányzó vagy hibás mező neve is visszajut KyLogicnak.

## 2. Biztonságos szövegelhelyezés és gyors előpróba

- A 1080×1920 képen az alapzóna: **bal 65, jobb 950, felső 231, alsó 1459**. Értékei egyetlen receptmezőből származnak, és adatként módosíthatók.
- Minden szöveg és ikonsor ebben marad, animáció közben is. Hosszú szöveg tördelődik és szükség esetén kisebb lesz; ha így sem fér el, az ellenőrzés elutasítja.
- Jelenetenként fenntartott területek védik a fő elemeket a feliratok átfedésétől.
- A `preview` valódi jelenetképeket készít, nem csak meglévő videó létezését jelzi. Zónakeretes JPG-kontaktlapot és elhelyezkedési jelentést ad vissza, végleges videó archiválása nélkül.
- A teljes videón minden képkocka tényleges szövegdobozait ellenőrizzük, beleértve a tördelést, betűméretet és animációs elmozdulást. Sikertelen ellenőrzésnél nincs archiválás.
- A képek és részletes jelentések védett VPS-es QA-területen maradnak; KyLogic kis eredményeket és védett letöltési hivatkozásokat kap. Nagy média nem kerül Lovable Cloud-tárhelyre.

## 3. Folytatható sorozatgyártás

A `series_run` sorrendje:

1. Jóváhagyás ellenőrzése a konkrét recepthez és kész próbavideóhoz kötve.
2. Leltár az ellenőrzött archívumnyugtákból; kész nyelvek kihagyása.
3. Az összes hiányzó hang, igazítás, fordítás és szükséges betű egyetlen nyelvenkénti listázása. Hiány esetén végleges gyártás még nem indul.
4. Minden hiányzó nyelv előpróbája; végleges gyártás csak akkor, ha mind átment.
5. Egyszerre egy videó, ötös ellenőrzőpontokkal; minden kész videó után nyugta és tartós esemény.
6. Újraindítás után folytatás a nyugták és ellenőrzőpontok alapján, már kész videó ismétlése nélkül.
7. Végső összesítés: kész, korábban kész és ezért kihagyott, hibás az okával.

Kifejezett `rerender`-lista új példányt enged **új `_v<timestamp>` célra**; a régi fájl és nyugta érintetlen. Az új univerzális sorozatot nem korlátozzák a régi IELTS-részfolytatási nyelvzárak; a régi receptek szabályai megmaradnak.

## 4. Ellenőrzések és érthető hibák

- Induláskor és receptregisztrálás után: futtatókép megléte és korlátozott próbaindítása, ellenőrzött receptfájlok olvashatósága, szükséges írásrendszerek betűi, szabad tárhely.
- Gyártás után: zóna és átfedések, 1080×1920, `yuv420p`, hangsáv, hanghosszhoz igazított videó és védett zárókép, teljes dekódolás, meglévő vágási védelmek.
- A KyLogic által adott igazítás `end` értéke a kezdőidőhöz adódó hossz; feliratban „Kájló” helyett „Kylo”. Nincs fizetős szolgáltatáshívás.
- Minden hibánál szakasz, kód, érthető üzenet, fájl, nyelv, jelenet és legfeljebb 200 kitakart naplósor érkezik a tartós eseménycsatornán. Titok vagy aláírt letöltőlink nem kerül naplóba.
- Új, korlátozott parancsok: `series_run`, `rerender`, `cancel`, `inventory`, `logs`, `qa_fetch`; meglévő regisztrálás, próba, újrapróba, szüneteltetés és folytatás megmarad.

## 5. Kötelező próbák és átadás

- Szándékosan kilógó szöveg bukjon; belül maradó menjen át. A megadott zónakoordináták külön szabálytesztet kapnak.
- Hosszú német és finn szöveg, animáció és jelenetütközés ellenőrzése.
- Kész nyelv kihagyása, hiányzó nyelv gyártási sorba kerülése, hiányzó hang korai összesített jelzése.
- Jóváhagyás kötése, ötös ellenőrzőpont, újraindítás utáni folytatás, ismételt kézbesítés és új verziós újragyártás.
- Hibajelentés kötelező mezői, titkok kitakarása, betű-/hozzáférési-/tárhelyhibák.
- Minden meglévő gyári teszt futtatása; régi receptek és források ellenőrzőösszegeinek megőrzése. A valódi régi archívum- és nyugtaegyezést a VPS-en is igazolni kell.
- Tiszta forrás-ZIP, SHA-256 és KyLogic-átadási leírás. Telepítés után külön szerveres `self_check`, futó készítőazonosító és telepítési napló igazolja az átvételt.

**Első tényleges futás:** KyLogic külön magyar Cambridge `preview` parancsa. A további 26 nyelv sorozata csak a tulajdonos jóváhagyása után indulhat.

## Műszaki megvalósítás és határok

- Külön univerzális receptváltozat és kiegészítő, digesttel rögzített készítő; a régi készítők és jelenetengedélyek változatlanok.
- A helyi SQLite-állapot additív bővítése sorozattervvel, nyelvenkénti állapottal, előpróbanyugtákkal és új verziós kimeneti azonossággal. Meglévő állapotot nem törlünk.
- A receptellenőrzés, kezelő, állapot, bemenetek és videóellenőrzés célzott bővítése; a készítő a tényleges böngészőbeli szöveghatárokat méri.
- Megmarad a kizárólag kifelé kapcsolódó HMAC-csatorna, a hálózat nélküli korlátozott renderkonténer, az archívum kizárólag olvasási letöltése és a közös gyártási zár. Nincs SSH vagy tetszőleges parancsfuttatás.
- Aktív videó készítését a telepítés nem szakíthatja meg. Szolgáltatásindítás nem jelent gyártási parancsot.
- A KyLogic másik projektben működik: az új parancs- és eseményszerződés ottani fogadását külön ellenőrizni kell. A Brain-oldali kód önmagában nem igazolja a teljes kapcsolatot.
- Helyi szabálytesztek nem helyettesítik a VPS-es előpróbát vagy gyártást; ebben a munkában a sandbox nem renderel videót. Éles telepítésnek és működésnek csak friss VPS-jelentéssel igazolt eredményt nevezünk.