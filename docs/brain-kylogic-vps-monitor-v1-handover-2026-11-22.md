# Brain → KyLogic: VPS visszajelzési kiegészítés v1

2026-11-22. Forráskiegészítés elkészült; VPS-telepítés és a KyLogic új eseményfogadása még nem igazolt. Gyártás, retry vagy új hang nem indult.

## A kapott KyLogic-válasz értékelése

A feltöltött visszajelzés szerint a mai `command_result`, `batch_verified`, `final_error`, `self_check` és `lease_recovered` tartós fogadása, a riasztási felület és a Kylo Admin értesítés elkészült. Ezek KyLogic által jelentett eredmények, nem ebben a projektben végzett éles ellenőrzések.

A dokumentum végén szereplő régi renderer_binding akadályt ne kezeld jelenleg igazolt hibaként: az új készítő bejegyzésének frissítése korábban elkészült, és a 20:33:23 UTC-s teljes VPS-önellenőrzés mind a 12 készítőt megfelelőnek találta. Ez nem helyettesíti a 182 bemenet új közös előellenőrzését és annak ACK-jét.

## Megvalósított Brain-kiegészítés

- Két külön háttérküldő: életjel és események. A gyártás, a médiaellenőrzés és a lassú esemény-ACK nem blokkolja az életjel-küldőt.
- Életjel célgyakorisága: 30 másodperc, a régi heartbeat-üzenet mezői és az aláírási szabály változatlanok. Ez a jelentőfolyamat életjele, nem képkocka-előrehaladás vagy az egész fő gyártási kör egészségének bizonyítéka. Hálózati hibák miatt a fogadás késhet.
- Eseménykimenő sor helyi vizsgálata 2 másodpercenként. Üres sorból nem indul eseményküldés; az életjel folyamatos. Nincs új Cloud-adatbázisfigyelő vagy időzített Cloud-feladat.
- Új események elkülönített, helyi tartós `monitor_outbox` sorban. Régi fogadó elutasítása nem blokkolja a régi `final_error` vagy parancs-ACK továbbítását; az új jelzések ACK-ig megmaradnak.
- Tényleges indulási bizonyíték csak a hét történet többnyelvű készítőjénél: a saját Docker-futtatás egyedi, root-private cidfile-jában létrejött konténerazonosító egyezik a Docker inspect eredményével, a konténer fut, és az image a jóváhagyott rögzített azonosító. Ez konténerindulást bizonyít, nem sikeres videót vagy elkészült első képkockát.
- Videónkénti archiválási esemény a végleges, ellenőrzött nyugta mentésével azonos SQLite tranzakcióban. A valódi manager előtte visszaellenőrzi az archívumpéldányt; a receptek és a kész videók változatlanok.
- A kitakart `failure_report.py` jelentése a meglévő `final_error.result.failure_report` mezőbe kerül, ugyanazzal a tartós kézbesítéssel. Nem kerül külön, versengő hibaküldő csatornába.
- Régi rendererek Docker-futtatása és ellenőrzői változatlanok; az új konténerindulás-megfigyelés csak a 26 nyelvű hét történetre vonatkozik.

## Fogadóprompt KyLogicnak

Kérlek bővítsd a meglévő, hitelesített eseményfogadót az alábbi új eseményekkel. Az URL, HMAC, agent/nonce/időbélyeg-ellenőrzés, teljes tartalomra kiterjedő ütközésvizsgálat és ACK-szabály maradjon változatlan. Új indítást vagy automatikus retry-t ne hozz létre.

A külső boríték változatlan:

```json
{"schema_version":1,"event_id":"UUID","kind":"...","entity_id":"...","result":{}}
```

Minden új monitor-esemény `result.monitor_version = "video-factory-monitor-v1"` értéket és egész számú `observed_at` UTC epoch másodpercet tartalmaz. A fogadás ideje ettől külön érték. Az időbélyeg önmagában nem indokol visszaléptetést; késő vagy ismételt eseményből nem lehet új riasztás/új kész videó.

### 1. `monitor_ready`

`entity_id = agent_id`.

```json
{
  "monitor_version":"video-factory-monitor-v1",
  "observed_at":1795380000,
  "heartbeat_interval_seconds":30,
  "event_poll_seconds":2,
  "independent_heartbeat":true,
  "independent_events":true,
  "production_authorized":false
}
```

A fenti időpont formátumpélda, nem tényleges szervermegfigyelés. Ez a marker nem gyártási engedély. Csak aktuális, hiteles, frissen fogadott marker és új életjelek után fogadd el, hogy a nem blokkoló csatorna átadása megtörtént. Régi vagy több perces késéssel újraküldött marker alapján ne élesíts időzítést. A kapcsolat megszakadása után újra ellenőrizd a friss életjeleket.

### 2. `video_progress`

`entity_id = job_id`.

Közös mezők:

- `monitor_version`, `job_id`, `recipe_id`, `recipe_version`, `recipe_sha256`;
- `video_id`, `language`, `story`;
- `cursor`: az éppen érintett videó 0-alapú indexe, nem kész darabszám;
- `attempt`: a jelenlegi gyár változatlan próbálkozásszámlálója; az első próbálkozásnál 0, nem új 1-alapú számozás;
- `total_videos`: a saját recept 26-os hossza;
- `phase`, `observed_at`.

A küldött fázisok: `preparing`, `ready`, `verifying`, `archiving`.

`preparing`: a feladat foglalása után, a sorozatkapu sikeres ellenőrzését követően kezdődik az előkészítés.

`ready`: az erőforrás-/bemeneti ellenőrzések és a javítófájlok előkészítése sikeres, a saját gyártási zár a managernél van, közvetlenül következik a Docker-futtatás. Erre lehet az adott videó indítási határidejét kötni. Ez még nem tényleges renderindulás.

A `verifying` és `archiving` egy már meglévő, helyreállított ideiglenes kimenet ellenőrzésekor is megjelenhet; ezekből ne gyárts `started_verified` bizonyítékot. Egy fázisjelzés nem folyamatos képkockamérés, a heartbeat sem az.

### 3. `started_verified`

`entity_id = job_id`. Az előző közös mezők mellett:

- `phase = "rendering"`;
- `container_id`: a saját konténer teljes, 64 hex karakteres azonosítója;
- `image`: teljes jóváhagyott `sha256:...` image ID;
- `evidence = "docker_running"`.

A fogadó a job/recept/image összerendelést ellenőrizze. Nem elég azonos nevű másik konténer vagy pusztán elindult Docker-kliens. Ha a folyamat nagyon gyorsan elkészül, előfordulhat, hogy nincs megfigyelhető indulási mintája, de később igazolt archiválási esemény érkezik: ez sikeres tétel, nem „nem indult el” hiba.

### 4. `video_archived`

`entity_id = job_id`. Közös mezők, továbbá:

- `phase = "archived"`;
- `completed_cursor = cursor + 1`: a saját sorozat igazolt kész indexe;
- `status`: a manager által mentett állapot, pl. `queued`, `paused`, `completed`;
- `archive_verified = true`;
- `receipt`: a meglévő teljes, ellenőrzött archiválási nyugta.

Kész tételt a `(recipe_id, recipe_version, video_id)` alapján egyszer számolj, ne az események számából. Egyezzen a várt video_id/nyelv/story, nyugtakulcs és receptkötés. A korábbi meglévő, visszaellenőrzött archívum felhasználása is ezt küldi, de nem jelent új renderindulást. Az ötös `batch_verified` továbbra is megmarad: ugyanaz a videó nem számolható még egyszer.

Mind a hét recept 26-os lezárásával és a nyugták ellenőrzésével lehet 182/182 kész; egyetlen `started_verified` vagy sikeres videó nem jelent teljes sorozatsikert.

### 5. `final_error.result.failure_report`

A régi `result.code` megmarad. Opcionális új mező: `failure_report`, melynek saját `schema_version` értéke `video-factory-failure-report-v1`.

A `codes_version` most `renderer-error-codes-v2`: külön, additív jegyzék mind a 105 régi kód és a hét történet tényleges, fix hibakódjai számára (összesen 184). A régi v1 hibajegyzék változatlan maradt. Ne utasítsd el a jelentést csak azért, mert az új verziót jelöli; a fix kódokat átveheted a csomagból, de ismeretlen szabad szöveget ne fogadj el.

Ellenőrizd a `job_id`, `recipe_id`, `recipe_version`, `recipe_sha256`, `attempt`, `agent_id` kötést és a `report_sha256` önhash-t a közös szigorú kanonikus JSON szerint. A `failure_id` alkalmas ugyanazon hiba ismétlésvédelmére.

`status = failed`: `errors` elemei fix lépést (`stage`), felsőszintű kódot, engedélylistás `detail_codes` értékeket, esetenként `scene`, `frame`, `cursor`, kötött `input_keys` mezőket tartalmaznak.

`status = diagnostic_unavailable`: a pontos diagnózis nem bizonyítható; `reason` és üres `errors` érkezik. Ne találj ki hibaokot, és ne vegyél át másik jobhoz tartozó helyi utolsó hibát. Ha maga a jelentésépítés sem lehetséges, a régi felsőszintű `final_error` akkor is továbbítódik.

Nincs nyers stderr, helyi fájlútvonal, szabad szövegű kivétel, gépi titok vagy bemeneti tartalom. A `production_authorized:false` a jelentésben változatlan: a jelentés nem újrapróbálási engedély.

### 6. `scheduler_waiting`

`entity_id = job_id`, a következő várakozó többnyelvű videó közös mezőivel, `phase = waiting`, `status = queued`, és fix `reason` értékkel. Nem indít új gyártást és nem változtatja meg a feladat státuszát.

Okok: `takeover_not_approved`, `production_lock_busy`, `legacy_producer_active`, `active_or_recovering_video`, `series_failed_or_blocked`, `series_paused`, `not_eligible`.

A zár foglaltsága nem bizonyítja, ki tartja a zárat. Az aktív/helyreállítás alatt álló videó és a szándékos szüneteltetés szabályos várakozás lehet. Hiányzó átvételi engedély, hibás sorozattárs vagy ismeretlen jogosultsági akadály legyen világosan látható blokkoló ok; ne vártass tíz órát pusztán `queued` felirattal. A `production_lock_busy` elhúzódása legyen külön, bizonytalanságot jelző várakozási riasztás, ne automatikus leállítás vagy tényként közölt producerhiba. A jelzés okváltozáskor keletkezik, nem minden ciklusban; újraindítás utáni ismétlését deduplikáld.

## Riasztások élesítési feltételei

- 2 perces átvételi figyelés csak a ténylegesen kiadott parancsra; figyelj arra, hogy a `claim` továbbra is a fő gyártási körben maradt. Az éppen készülő videó alatt másik, még ki nem kézbesített sorozatparancs szabályosan várhat. KyLogic várólistára helyezése nem azonos a VPS-nek ténylegesen kézbesített paranccsal.
- 5 perces indulási figyelés csak az aktuális videó friss `ready` bizonyítéka után. A másik 181 várakozót ne riaszd egyenként. `started_verified` vagy igazolt `video_archived` oldja fel ezt a várakozást.
- 5 perces életjelhiány csak frissen átadott nem blokkoló csatornára. Ez kapcsolat-/jelentőfolyamat-riasztás, nem bizonyított képkocka-elakadás.
- A gyártás közbeni előrehaladás hiányát külön figyeld, mért render/QA időkhöz igazítva. A mostani csomag fázis- és videószintű jelzéseket ad, nem élő képkockaszámlálót; 5 perc változatlan `rendering` önmagában még nem bizonyít hibát.
- Sikertelen feladat továbbra is megállítja a többi érintett sorozat továbbhaladását, ezt közös blokkoló okként mutasd.
- A riasztás nem indít gyártást, nem módosít receptet/engedélyt, nem töröl archívumot.

## Elfogadás

KyLogic: új eseménytípusok tartós fogadása/ACK-je, késő és ismételt események, 0-alapú kurzor/próbálkozás, batch+videó kettős számlálás elkerülése, hibajelentés kötése, régi marker és szabályos várólista tévesriasztásának kizárása.

Brain: független küldők, blokkolt esemény-ACK melletti életjel, elveszett ACK utáni azonos újraküldés, régi és új sorok egymástól független kézbesítése, saját/pinelt konténerindulás, azonnali indítási hiba, végleges archiválási esemény és kitakart részlethiba regressziós vizsgálata.

Éles elfogadás csak valódi VPS-telepítés, friss marker+életjelek és KyLogic tartós visszaolvasás után állítható. Éles próbagyártást kizárólag a már jóváhagyott KyLogic-folyamat indíthat; innen nem indítunk újat.

Brain helyi eredmény: 455 videógyári automatizált próba sikeres, telepítőszintaxis és minden SHA256SUMS-bejegyzés megfelelő. A vizsgálat nem készített éles videót. A kiegészítés éles VPS/KyLogic átvétele még nincs igazolva.

### Opcionális, csak olvasó VPS-forrásellenőrzés

Az alábbi parancs a felkerült fájlokat ellenőrzi, nem indít managert/gyártást, nem olvas gépi titkot, és nem helyettesíti a friss futófolyamat-marker KyLogic ACK-jét:

```bash
sudo python3 -u -c 'import sys,json,hashlib; from pathlib import Path; r=Path("/opt/kylo-video-factory/current").resolve(); sys.path.insert(0,str(r)); import monitoring as m, failure_report as f; sums={name:h for h,name in (line.split("  ",1) for line in (r/"SHA256SUMS").read_text().splitlines())}; names=("agent.py","state.py","monitoring.py","failure_report.py","renderer_error_codes_v2.json"); assert all(hashlib.sha256((r/n).read_bytes()).hexdigest()==sums[n] for n in names); print(json.dumps({"monitor_source_install_ok":True,"protocol":m.PROTOCOL,"heartbeat_seconds":m.HEARTBEAT_SECONDS,"codes_version":f.CODES_VERSION,"runtime_ack_verified":False,"render_started":False}))' > /dev/tty 2>&1; printf 'Ellenorzes kilepesi kodja: %s\n' "$?" > /dev/tty
```

## Következő lépések és felelősök

1. Sándor: ezt a dokumentumot továbbítja KyLogicnak; KyLogic beköti az új jelzések fogadását.
2. Sándor: egyszer publikálja a Brain-frissítést, mert ez juttatja a VPS-re a külön küldőket és a jelzéseket.
3. Brain: utána ellenőrzi a telepítési visszajelzést; közvetlen SSH nélkül szükség esetén csak olvasó ellenőrzést ad.
4. KyLogic: visszaigazolja a friss `monitor_ready`, életjelek és új események tartós fogadását; csak ezután élesíti az időhatáros riasztásokat.
5. A 182-es gyártás továbbra is az eredeti, sikeres előellenőrzéshez/ACK-hez/jóváhagyáshoz kötött. Ez a frissítés nem indítóutasítás.
