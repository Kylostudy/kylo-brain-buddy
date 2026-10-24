# Roadmap

- [x] Önálló VPS-videógyár: feltöltött követelmények és friss szerverjelentés felmérése (2026-10-24 13:54 UTC; 1274 ellenőrzött videó, completed, service failed a lezárás után)
- [ ] Önálló VPS-videógyár: közvetlen KyLogic feladatsor és gépi hitelesítés (blokkoló: KyLogic-oldali kapcsolat még nincs megvalósítva)
- [x] Önálló VPS-videógyár: előkészítő kezelő, helyi tartós feladatsor, aláírt kifelé kapcsolódó kliens, recept-/jóváhagyási szabályok, helyi archívum, telepítő és kapcsolódási dokumentáció; 20 új szabályteszt és 13 meglévő/regressziós teszt sikeres; tiszta ZIP átadva
- [x] Subject factory: completed nyugta megakadályozza az újraindítást, hiányzó auto-removed konténer normál lezárásnak számít; három regressziós teszt sikeres
- [ ] Önálló VPS-videógyár: meglévő recept exportja és IELTS 27 nyelvi csomag (blokkoló: a jóváhagyott eredeti csomagok nem érkeztek meg)
- [ ] Önálló VPS-videógyár: valódi host-felmérés, átvizsgált renderer, médiacsomag-transzfer, publikálási olvasás és Telegram-bekötés (blokkoló: védett KyLogic-kapcsolat, host-hozzáférés és jóváhagyott runtime szükséges)
- [ ] Önálló VPS-videógyár: S3/SFTP illesztések és alternatív tároló próba (blokkoló: szolgáltató/hozzáférés és önálló átviteli ellenőrzés még nincs)
- [x] Önálló VPS-videógyár: v1.1 csomag (KyLogic valódi címével) integritása igazolva, SHA256SUMS javítva (doksik nem a csomagban), inventory.py systemctl-hiány tűrése; telepítő-próba hibátlan, 20 teszt OK
- [x] Önálló VPS-videógyár: staging telepítés bekötve a worker/deploy.sh 2e lépésébe (nsenter mintára; csak előkészít, nem aktivál)
- [ ] Önálló VPS-videógyár: staging telepítés igazolása; 15:21 UTC-kor a kód megérkezett, de üres release-lista/inactive. Előkészítési hibák explicit jelentése javítva; friss szervernapló szükséges.
- [ ] Önálló VPS-videógyár: aktiválás és hét valódi elfogadási próba (blokkoló: gépi titok a védett konfigurációba, jóváhagyott receptek, közvetlen VPS-hozzáférés nincs igazolva)

- [x] Subject factory: külön hitelesített csomagfogadó és 9 teszt, helyi HTTP 401/403/400 ellenőrzés
- [x] Subject factory: KyLogic átadási leírás és teljes 17 fájlos JSON-példa
- [x] Subject factory: konkrét letöltési hiba reprodukálása (ERR_INVALID_IP_ADDRESS), javítása és 10 teszt
- [x] Subject factory: javított fogadó VPS-re juttatása és újrapróbálás (12:20-as frissítés sikeres; a 13:12-es új próba existing_file_conflict hibával megállt)
- [x] Subject factory: ütköző, ellenőrizetlen csomagmappa automatikus félretétele (nem törlés), 11 teszt OK
- [x] Subject factory: 17 fájl átvéve; saját ellenőrzött telepítő (safe-install.sh) a deployba kötve
- [x] Subject factory: telepítés lefutásának igazolása a szervernaplóból
- [x] Subject factory: korlátozott, kitakart telepítési napló és gyártóállapot jelentő elkészült; 5 teszt és 11 archívumvédelmi próba sikeres
- [x] Subject factory: VPS-es naplójelentés első beérkezésének igazolása
- [x] Subject factory: szlovénnél jelentkező IndexError(3) oka javítva (a mentési tartalékút hibás, az archívum változatlan); egyszeri újraindítás a szerverfrissítésbe kötve
- [x] Subject factory: szlovén mentési javítás VPS-en igazolva; kozgaz-21 összesen 26 nyelven ellenőrzött, köztük SL/HR/RO/SV/NO
- [x] Subject factory: következő master indítási hibája reprodukálva (Chromium crashpad, írhatatlan HOME); írható HOME/XDG javítás és egyszeri újraindítás előkészítve
- [x] Subject factory: javított indítás VPS-es igazolása és következő új ötös adag; 2026-10-24 friss jelentésben 1274 verified, completed; a lezárás utáni service-hiba javítása külön előkészítve

- [x] Platformonként kizárni minden sütikeverést és hibás tartalék adatot
- [x] Tartós, munkafolyamatonként külön böngészőprofilt használni Live Browse-ban és futtatáskor
- [x] Egységes, workerhez illő böngészőazonosságot beállítani
- [x] Facebook teljes belépési sütipárját kötelezővé tenni és proxyt előírni
- [x] Meglévő közösségi munkafolyamatok IP-, platform- és időzóna-adatait rendezni
- [x] Ellenőrizni a kódot, az összeállítást és az adatokat
