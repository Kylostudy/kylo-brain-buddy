# Roadmap

- [x] v1.4 hozzáférési javítás beépítve az eddigi hibajelentés, betűk és nyelvi korlátok megtartásával; meglévő recept is javul renderelés előtt, archívum változatlan.
- [ ] v1.4 VPS-átvétel: a4d95270-451e-4990-81e0-7ec5b78579fe frissítés pending; 60 gyártó- és 7 jelentőteszt OK. Japán újrapróba blokkolója: frissítés igazolása után KyLogic job_id-alapú retry parancsa szükséges; Brainben nincs külön japánindító végpont. Sorozat nem indítható.

- [x] v1.3: csak olvasási archívumgyökér, megnevezett hiányzó fájl és folytatási nyugták jelentése beépítve; kapott csomag 35, integrált változat 55 + 5 teszt OK. Korábbi betű- és részlegesfolytatás-szabályok megmaradtak.
- [ ] v1.3 VPS-átvétel és friss négy nyugta/indítási napló: 54e6bff0-1849-4113-bbff-c664e0a74208 frissítés kérve. Betűk továbbra is receptadatként érkeznek, japán szemrevételezés nincs; gyártási parancs nincs.

- [x] Receptelakadás: naplóban continuation_languages_restricted; részleges folytatás szigorú kimaradási jegyzékkel és tartós command_result hibával elkészült.
- [x] Receptbeli opcionális font, négy OFL betűadat és külön változatú renderelő előkészítése; 46 szabályteszt sikeres, négy írásrendszer mintakarakterei a betűkben megtalálhatók.
- [ ] Új változat VPS-es átvétele és japán próbavideó szemrevételezése; KyLogic új receptje és tulajdonosi jóváhagyás szükséges, nincs automatikus sorozatindítás.

- [x] Videógyár első frissítés utáni indítása: sikeres háttér-előkészítéshez kötött aktiválás; késleltetett, sikertelen és már kész előkészítés tesztje sikeres, összesen 38 próba OK.
- [ ] Indítási sorrend javításának VPS-es igazolása: a frissített deploy átvétele és új szolgáltatásnapló szükséges; ebben a javításban éles indítás nem történt.

- [x] Cseh IELTS próba: ellenőrzött médiacsomag, átvizsgált gyártó, egyetlen videóra korlátozott indítás és védett jelentések előkészítve; 28 gyártóteszt és 5 jelentőteszt sikeres.
- [x] Cseh IELTS próba: 17:05-ös hiba oka megvan (a tight-cut 1,5 mp-et vágott, a hosszellenőrzés elutasította); renderelő pontos hosszra javítva, egyszeri újrapróba + hibakód a jelentésben, 31 teszt OK
- [ ] Cseh IELTS próba: újrapróba VPS-es lefutása és archivált eredmény igazolása; blokkoló: Brain publikálása szükséges. Nincs sorozat vagy közösségi publikálás.

- [x] Önálló VPS-videógyár: feltöltött követelmények és friss szerverjelentés felmérése (2026-10-24 13:54 UTC; 1274 ellenőrzött videó, completed, service failed a lezárás után)
- [ ] Önálló VPS-videógyár: közvetlen KyLogic feladatsor és gépi hitelesítés (blokkoló: KyLogic-oldali kapcsolat még nincs megvalósítva)
- [x] Önálló VPS-videógyár: előkészítő kezelő, helyi tartós feladatsor, aláírt kifelé kapcsolódó kliens, recept-/jóváhagyási szabályok, helyi archívum, telepítő és kapcsolódási dokumentáció; 20 új szabályteszt és 13 meglévő/regressziós teszt sikeres; tiszta ZIP átadva
- [x] Subject factory: completed nyugta megakadályozza az újraindítást, hiányzó auto-removed konténer normál lezárásnak számít; három regressziós teszt sikeres
- [ ] Önálló VPS-videógyár: meglévő recept exportja és IELTS 27 nyelvi csomag (blokkoló: a jóváhagyott eredeti csomagok nem érkeztek meg)
- [ ] Önálló VPS-videógyár: valódi host-felmérés, átvizsgált renderer, médiacsomag-transzfer, publikálási olvasás és Telegram-bekötés (blokkoló: védett KyLogic-kapcsolat, host-hozzáférés és jóváhagyott runtime szükséges)
- [ ] Önálló VPS-videógyár: S3/SFTP illesztések és alternatív tároló próba (blokkoló: szolgáltató/hozzáférés és önálló átviteli ellenőrzés még nincs)
- [x] Önálló VPS-videógyár: v1.1 csomag (KyLogic valódi címével) integritása igazolva, SHA256SUMS javítva (doksik nem a csomagban), inventory.py systemctl-hiány tűrése; telepítő-próba hibátlan, 20 teszt OK
- [x] Önálló VPS-videógyár: staging telepítés bekötve a worker/deploy.sh 2e lépésébe (nsenter mintára; csak előkészít, nem aktivál)
- [ ] Önálló VPS-videógyár: 15:57 UTC frissítés sikeres, de host ffmpeg hiány miatt staging és titokátadás nem futott le. Fix ffmpeg/openssl host-előkészítés bekötve; következő szervernaplóval igazolandó.
- [ ] Önálló VPS-videógyár: aktiválás és hét valódi elfogadási próba (blokkoló: gépi titok a védett konfigurációba, jóváhagyott receptek, közvetlen VPS-hozzáférés nincs igazolva)
- [ ] Videógyár gépi titkának titkosított VPS-bekötése: hitelesített átadó és root-only mentés elkészült; publikálás és friss szervernapló szükséges a tényleges beállítás igazolásához.

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
