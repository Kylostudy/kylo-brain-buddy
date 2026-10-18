# Roadmap

- [x] Subject factory: külön hitelesített csomagfogadó és 9 teszt, helyi HTTP 401/403/400 ellenőrzés
- [x] Subject factory: KyLogic átadási leírás és teljes 17 fájlos JSON-példa
- [x] Subject factory: konkrét letöltési hiba reprodukálása (ERR_INVALID_IP_ADDRESS), javítása és 10 teszt
- [x] Subject factory: javított fogadó VPS-re juttatása és újrapróbálás (12:20-as frissítés sikeres; a 13:12-es új próba existing_file_conflict hibával megállt)
- [x] Subject factory: ütköző, ellenőrizetlen csomagmappa automatikus félretétele (nem törlés), 11 teszt OK
- [x] Subject factory: 17 fájl átvéve; saját ellenőrzött telepítő (safe-install.sh) a deployba kötve
- [ ] Subject factory: telepítés lefutásának igazolása a szervernaplóból
- [ ] Subject factory: korlátozott telepítési napló és gyártóállapot rendszeres visszaküldése a Brainnek
- [ ] Subject factory: első új ötös adag, master-renderelés és szünet/újraindulás igazolása (várakozás: telepítés)

- [x] Platformonként kizárni minden sütikeverést és hibás tartalék adatot
- [x] Tartós, munkafolyamatonként külön böngészőprofilt használni Live Browse-ban és futtatáskor
- [x] Egységes, workerhez illő böngészőazonosságot beállítani
- [x] Facebook teljes belépési sütipárját kötelezővé tenni és proxyt előírni
- [x] Meglévő közösségi munkafolyamatok IP-, platform- és időzóna-adatait rendezni
- [x] Ellenőrizni a kódot, az összeállítást és az adatokat
