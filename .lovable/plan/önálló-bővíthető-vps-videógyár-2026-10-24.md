# Önálló, bővíthető VPS-videógyár

## Ellenőrzött kiindulás

A 2026. október 24. 15:54-es budapesti szerverjelentés **1274 ellenőrzött videót és befejezett gyártási sort** mutat. A lezáráskor a már eltávolított konténer leállítása hibás szolgáltatásállapotot hagyott. Jelenleg ez a gyártó nem készít új videót; a teljes archívum darabszámát nem mértük újra.

A gép 8 processzormaggal és körülbelül 64 GB memóriával jelentkezik, a mért lemez 28,5%-a foglalt. A pontos szabad tárhely és a külön csatolt lemezek még felmérendők. Közvetlen szerverbelépés nincs igazolva; a meglévő védett frissítési út használható előkészítésre, telepítés csak friss szerveres bizonyítékkal jelenthető.

## Mit készítünk

### 1. Biztonságos szerverfelmérés és a régi gyártás megőrzése
- Korlátozott, csak olvasó felmérés: tényleges szabad tárhely, csatolások, futó munkák, telepített változatok és meglévő nyugták.
- A szakmai recept, hangok, masterek, feliratok és vágás változatlan, ellenőrzőösszeges mentése; a lezárási hiba célzott javítása, újragyártás nélkül.
- Az új kezelő kezdetben nem vehet át termelést: az átvétel külön ellenőrzött lépés. Az archívum érintetlen marad.

### 2. Brain nélkül működő kezelő
- Tartós feladatnyilvántartás a VPS-en, biztonságos foglalás, életjel, lejárat, egyszeri végrehajtás és megszakítás utáni folytatás.
- Egyszerre egy videó, alapból ötös ellenőrzött adagok. Kevés hely vagy ismétlődő hiba esetén megállás.
- Külön ellenőrzési nyugta a teljes kép-/hangdekódolásról, méretről, képarányról és az archivált példány visszaolvasott ellenőrzőösszegéről.
- Szünet, folytatás és korlátozott újrapróbálás; automatikus közösségi publikálás nélkül.

### 3. Közvetlen KyLogic-kapcsolat
- A VPS kifelé indított HTTPS-kapcsolattal kér feladatot és küld eredményt a KyLogicnak.
- Pontos, verziózott kapcsolódási szerződés és VPS-kliens; külön gépi hitelesítés, visszajátszás elleni védelem és naplózás.
- A KyLogic-oldali feladatsor, tulajdonosi jóváhagyás és jogosultságellenőrzés külön elkészítendő. Enélkül a teljes vezérlést nem nevezzük késznek.
- A meglévő Brain/YouTube-publikálási folyamat ettől független marad.

### 4. Bővíthető receptek
- Verziózott, ellenőrzőösszeges adatcsomagok: jelenetek, nyelvek, időzítés, felirat, CTA és meglévő média.
- Támogatott adatváltoztatás nem igényel szerver-újratelepítést; tetszőleges parancs, függőségtelepítés és titokolvasás tiltott.
- Új futtatható jelenetkód külön ellenőrzést és jóváhagyást igényel; új függőség esetén „egyszeri bővítés szükséges” állapot.
- Új receptből egy próbavideó, teljes sorozat csak tulajdonosi jóváhagyás után. IELTS előbb mind a 27 nyelven, Cambridge csak utána.
- Valós IELTS-receptet nem találunk ki: a jóváhagyott csomagot a KyLogicból kell átvenni.

### 5. Cserélhető archívum és értesítések
- Stabil videóazonosító és több fizikai példányt kezelő katalógus; külön helyi, S3-kompatibilis és SFTP-tárolási illesztés.
- Most a VPS-archívum marad. Alternatív tárolót csak elkülönített tesztvideóval ellenőrzünk; termelési költözés és automatikus forrástörlés nincs.
- Videógyári végleges hibák a Kylo Admin-beszélgetésbe; napi összefoglaló reggel 8-kor, beragadt munkákkal. Más leállított értesítéseket nem kapcsolunk vissza.
- Új fizetős hanggenerálás csak külön költségjóváhagyással.

## Technikai megvalósítás
- Új, elkülönített `infra/video-factory/` modul, hostoldali tartós állapot és szigorúan engedélyezett műveletek; a jelenlegi gyártó nem lesz általános távoli parancsfuttató.
- Külön megbízás-UUID és receptazonosító/verzió; tartós idempotencia, foglalási token és verzióhoz kötött jóváhagyás.
- Hálózat nélküli, erőforrás-korlátos renderfuttatás; a letöltés és eredményjelentés külön folyamat. Videó sem Cloudban, sem sandboxban nem készül.
- Végleges fájl csak kizárólagos, felülírást tiltó mentéssel; nyugta és ellenőrzött visszaolvasás után kizárólag átmeneti kimenet takarítható.
- A gépi titok és a letöltési címek külön védett konfigurációban élnek, nem receptben vagy naplóban.

## Átadás és bizonyítás

Átadjuk a szerverfelmérést, telepítőt, kapcsolódási szerződést, példa adat-receptet, üzemeltetési/visszaállítási leírást és a KyLogic-oldali munkák listáját. Ha a meglévő telepítési út nem biztosítja az új kezelő biztonságos telepítését, tiszta átadható csomag készül, nem állítunk sikeres telepítést.

Külön jelöljük: **elkészült**, **VPS-re települt**, **valódi futással ellenőrzött**. A hét elfogadási próba lefedi a valódi próbavideót és visszaolvasást, Brain-kiesést, dupla kézbesítést és újraindítást, jogosulatlan csomagot és kevés helyet, régi receptet, jóváhagyási korlátot, valamint alternatív tárolót.

**Külső függőségek:** KyLogic-oldali védett feladatsor és jóváhagyás; valódi szakmai/IELTS receptcsomagok; elkülönített gépi hitelesítés; alternatív tárolási próbához védett hozzáférés. Ezek hiányában az érintett éles próbák nyitva maradnak.