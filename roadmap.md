# Roadmap

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
- [ ] Subject factory: javított indítás VPS-es igazolása és következő új ötös adag (blokkoló: a 15:59 UTC frissítés még a régi 33845d6 kódot vette át, a HOME/XDG v3 javítás még nem jutott a szerverre; gyártó továbbra is failed)

- [x] Platformonként kizárni minden sütikeverést és hibás tartalék adatot
- [x] Tartós, munkafolyamatonként külön böngészőprofilt használni Live Browse-ban és futtatáskor
- [x] Egységes, workerhez illő böngészőazonosságot beállítani
- [x] Facebook teljes belépési sütipárját kötelezővé tenni és proxyt előírni
- [x] Meglévő közösségi munkafolyamatok IP-, platform- és időzóna-adatait rendezni
- [x] Ellenőrizni a kódot, az összeállítást és az adatokat
