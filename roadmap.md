# Roadmap

- [x] Subject factory: külön hitelesített csomagfogadó és 9 teszt, helyi HTTP 401/403/400 ellenőrzés
- [x] Subject factory: KyLogic átadási leírás és teljes 17 fájlos JSON-példa
- [x] Subject factory: konkrét letöltési hiba reprodukálása (ERR_INVALID_IP_ADDRESS), javítása és 10 teszt
- [x] Subject factory: javított fogadó VPS-re juttatása és újrapróbálás (12:20-as frissítés sikeres; a 13:12-es új próba existing_file_conflict hibával megállt)
- [ ] Subject factory: a felhasználó által engedélyezett sikertelen /var/brain/factory-packages/subject-20261018-v1 csomagmappa egyszeri, naplózott törlése (blokkoló: nincs közvetlen VPS-elérés vagy meglévő korlátozott törlési művelet; törlés nem történt). A végleges /var/brain/archive érintetlen marad.
- [ ] Subject factory: valódi 17 fájl ellenőrzött átvétele, forrásvizsgálat és engedélyezett telepítés (csomag elküldve; teljes átvétel még sikertelen)
- [ ] Subject factory: első új ötös adag, master-renderelés és szünet/újraindulás igazolása (várakozás: telepítés)

- [x] Platformonként kizárni minden sütikeverést és hibás tartalék adatot
- [x] Tartós, munkafolyamatonként külön böngészőprofilt használni Live Browse-ban és futtatáskor
- [x] Egységes, workerhez illő böngészőazonosságot beállítani
- [x] Facebook teljes belépési sütipárját kötelezővé tenni és proxyt előírni
- [x] Meglévő közösségi munkafolyamatok IP-, platform- és időzóna-adatait rendezni
- [x] Ellenőrizni a kódot, az összeállítást és az adatokat
