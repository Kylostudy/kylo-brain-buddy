# Roadmap

- [x] Malacpersely többnyelvű (26 nyelv) kiadás telepítve és igazolva: piggy-bank-multilang-safe-v1 / piggy-bank-i18n-v1, kép sha256:842e212260ce75ee4e6cbbefe685e756110a012c72f69336d7ff11f1dd1ec8b7. 2026-11-08 13:55:43 UTC teljes önellenőrzés ok:true, mind a 8 készítő + tárhely OK, KyLogic acknowledged:true, esemény 92480d7e-343f-4b6e-8592-8277b6bdf501. 188 Python + 11 Bun teszt OK; narráció/próba/sorozat/recept nem indult.
- [ ] EN próba indítása: KyLogic külön malacpersely-i18n-en-trial receptje + angol narráció + érmehangfájl kell; utána tulajdonosi jóváhagyás, majd a 25 nyelvű folytatás (malacpersely-i18n-continuation) külön jóváhagyással. Innen nem indult render.
- [x] 424bf311-fe2a-424e-9d0d-1342f9a6eb09 hibajelentés: tulajdonosi VPS-kivonat piggy_empty_layout/exit 1. Nulla szélességű Remotion előzetes befogadó reprodukálva; külön piggy-bank-layout-safe-v2 forrás fix 1080×1920 alappal, eredeti renderer érintetlen. 165 Python és 3 Bun/13 állítás sikeres; ellenőrzőösszegek frissítve, nincs render/narráció/recept/retry.
- [x] Malacpersely javítókiadás VPS-telepítése igazolt: a2338f9c frissítés succeeded, 10:04:24 UTC életjelben 10:01:59 UTC teljes self_check ok:true, mind a nyolc készítő/tárhely OK, KyLogic acknowledged:true, a450542c-5fd6-441a-a68f-fc4fab13a8cd. piggy-bank-layout-safe-v2 image sha256:62ee7bda794b79cb0fa65a9cebd36e70d62750fd63ef20e0409b4f14510c8f80; v1 továbbra is 15fde4038a….
- [ ] Javított magyar próba: KyLogic külön receptverziója használhatja piggy-bank-layout-safe-v2-t; régi recept/feladat nem módosítható. Blokkoló: KyLogic új receptje és külön próbaindítása, innen nem indult render/retry/narráció.
- [x] 2026-11-08 08:56:24 UTC tulajdonosi VPS-visszaolvasás: teljes önellenőrzés ok:true, KyLogic acknowledged:true, esemény c5391a55-067e-473a-abaf-f3606c95ccb2. IELTS-fonts két jegyzéke egyezik, elérhető kép 0e178825…; korábbi zár/hivatkozás vizsgálati tételek lezárva ezzel az eredménnyel, gyártás nélkül.

- [ ] 2026-11-08 08:48 UTC védett IELTS-hivatkozásjavítás nem futott: az egyik nem blokkoló zár foglalt, semmi nem módosult, új önellenőrzés nem indult. Következő lépés kizárólag a két zár tulajdonosának azonosítása; foglaltság nem bizonyít renderelést, védelem megkerülése/folyamat leállítása tilos bizonyíték nélkül.

- [ ] 2026-11-08 08:47 UTC két jegyzékből igazolt: exam-v1/safe-v2/safe-v3 már helyes; csak config.json IELTS-fonts azonosítója (1f7b3b4f…) tér el a reviewed-renderers és közvetlen Docker-próba 9a97cf2f… azonosítójától. Következő célzott host-javítás kizárólag ezt az egy mezőt szinkronizálja, teljes sikeres leltár + régi ID hiány + új ID indulás + változatlan reviewed/scenes ellenőrzéssel, két nem blokkoló zárral és helyi mentéssel; utána self-check-only. Manager újraindítás, képépítés, receptek, archívum, fontok érintetlenek.

- [ ] 2026-11-08 08:45 UTC közvetlen inspect igazolta a helyi címkék teljes azonosítóit és visszakereshetőségét: IELTS-fonts=9a97cf2f…, exam-v1=aa3f0028…, safe-v2=727aff38…, safe-v3=fa71cd8a…. A hibás önellenőrzés más azonosítókat keresett; a hibás hivatkozások keletkezésének oka nem bizonyított. Javítás előtt a config és reviewed-renderers kizárólag kép/jelenet/jóváhagyás mezői összevetendők; működő képek nem cserélhetők, manager nem indítható újra.

- [ ] 2026-11-08 08:44 UTC feltöltött teljes képleltár: IELTS-fonts/exam-v1/exam-safe-v2 ellenőrzött címkéi jelen vannak, a 08:42 önellenőrzés hivatkozott azonosítói viszont nem szerepelnek; v3 sikeres azonosítója sem szerepel. Ezért törlés nem bizonyított, képazonosító-típus/névfeloldás eltérés is vizsgálandó. Következő kizárólag olvasási próba: a négy címke docker image inspect Id/RepoDigests és a kapott Id közvetlen visszakeresése; config nem változhat enélkül.

- [ ] 2026-11-08 08:42:32 UTC feltöltött VPS-önellenőrzés: ok:false, KyLogic acknowledged:true (a61f1815-9b87-4bbf-be44-7bcd84223e9a). Malacpersely/v3/v4/IELTS-alap és tárhely OK; IELTS-fonts/exam-v1/exam-safe-v2 image_inspect returncode=1. A hiba nem csak régi jelentés: friss Docker-leltár és a három helyi ellenőrzött képcím inspect eredménye kell az ok és biztonságos javítás meghatározásához; nincs törlés, új publikálás vagy gyártás.

- [ ] 2026-11-08 08:38 UTC: tulajdonos megerősítette a közzétételt; új publikálás nélkül VPS-átvétel ellenőrizve. 88558185 frissítés 08:36:08 UTC sikeres; 08:39:21 UTC életjel aktív videógyár/lezárt előkészítések, malacpersely image_ok, 08:35:13 UTC teljes önellenőrzés négy régi képazonosítót nem talál és KyLogic acknowledged:true. Blokkoló: előkészítések UTÁNI új teljes ellenőrzés és aktuális Docker-leltár; meglévő távoli kizárólag-diagnosztikai indítás nincs, helyi self-check-only.py SSH-ból futtatható manager/recept/gyártás nélkül. Új publikálás, frissítés vagy gyártás nem indult.

- [ ] 2026-11-08 08:07 UTC tulajdonosi kérés: próbára kész állapot. A legújabb malacpersely-készítő VPS-en telepítve és image_ok; tényleges kép sha256:15fde4038a0a764585a19e99f7c1d391a1a1b23c217a92d4d0d03901ec80fb4b. Blokkoló: a legfrissebb teljes önellenőrzés (08:10:44.485457 UTC, 08:33:17 UTC életjelben) ok:false, IELTS-fonts/exam-v1/exam-safe-v3 image_inspect hibával; KyLogic acknowledged:true. Új publikálást a tulajdonos elutasított, új telepítést nem kértem; hang és külön HU recept/próba továbbra is szükséges, gyártás nem indult.

- [x] VPS böngészős feladatok végleges tiltása minden platformon: éles adatvédelmi indítási korlát, Reddit aktiválási próba active=false, claim/record-claim 204; 2 Bun (74 állítás) és 3 Python próba sikeres. Böngésző nélküli feladatok megőrizve.
- [x] Futó Reddit-böngésző leállítása és VPS-es tiltás átvételi igazolása: 71d02b5 frissítés 2026-11-08 07:50:08 UTC sikeres; recorder leállítása ok:true; 08:03:52 UTC nulla aktív munkafolyamat, minden felvétel cancelled/closed, négy adatvédelmi tiltás aktív, friss green életjelben nincs recorder.
- [x] 2026-11-08 újbóli ellenőrzés: éles engedélylista csak archive_video/receive_subject_factory_package; 08:06 UTC nulla aktív munkafolyamat/feladatsor, claim és record-claim HTTP 204; 4 Bun (80 állítás), 3 Python teszt OK. Régi nem videós feladatok lezárva, archívum/videógyár érintetlen.
- [x] Böngészőindítás további megerősítésének VPS-átvétele: 87fbf254 frissítés 08:07:08.868 UTC succeeded; 08:32:35 UTC életjel nulla futó feladat, csak orchestrator/shots/autoheal, recorder nincs; 4 Bun/80 állítás ismét sikeres.

- [x] Malacpersely: elkülönített piggy-bank-safe-v1 forrás, scene piggy-bank-v1, szigorú hétjelenetes adatbemenet, csak egy HU próba és sorozattilalom; 161 gyári (18 új), 8 brief, 15 diagnosztikai és 3 Bun teszt sikeres. Checksumok/szintaxis OK; gyártás/publikálás nélkül, vizuális vagy Docker/VPS-próba nem történt.
- [x] Malacpersely VPS-telepítés és KyLogic-átvétel igazolt: kép sha256:15fde4038a0a764585a19e99f7c1d391a1a1b23c217a92d4d0d03901ec80fb4b, image_ok. 07:52:58 UTC teljes ellenőrzés ok:true/acknowledged:true; későbbi 08:10:44 UTC ellenőrzésben három régi készítő nem elérhető, ezért teljes próbára kész állapot NEM igazolt. 163 helyi gyári teszt OK; nincs render/narráció/receptregisztráció.

- [x] IELTS helyreállítási korlát javítva: csak sikeres teljes Docker-leltárban igazoltan hiányzó régi képazonosító javítható, változatlan jelenet/jóváhagyás mellett; működő kép és bizonytalan hiba érintetlen. Teljes önellenőrzés időponttal, tényleges képazonosítóval és pontos hibaszakasszal; 143 gyári teszt OK.
- [ ] IELTS pontos VPS-ok, javítás telepítése és teljes önellenőrzés/KyLogic átvétel igazolása: közvetlen szerveres vezérlés nincs, SSH-ból csak a két IELTS-képbejegyzés és Docker-próba eredménye szükséges. v4 image ID a 2026-11-01 06:42:49 UTC védett jelentés naplójában igazolt: sha256:a4a7ff47aca59b14d1f4fd0c30119162249b07ff03f327ed34d77e0ddc07c89e. Gyártás és új recept nélkül; működő készítők és archívum érintetlen.

- [x] HTTP diagnosztikai csomag célzottan beépítve: művelet, státusz, csak hitelesített engedélylistás hibakód és helyi fázis; korábbi gyári védelem megtartva, 117 gyári teszt sikeres.
- [ ] HTTP diagnosztika VPS-átvétel és első valódi részletes hiba: frissített változat publikálása/telepítése szükséges; régi 400 oka visszamenőleg nem állítható helyre.

- [x] 2026-10-28 automatikus vágás: frozen+silent képkockás vágás, feliratidők és layout-indexek újraszámítása, ismételt dekódolás és QA; 113 gyári + 15 diagnosztikai teszt sikeres. Javított változat publikálása kérve.
- [ ] 2026-10-28 szerveres magyar előpróba: 06:11 UTC jelentés szerint univerzális háttértelepítés 06:09:13 UTC-kor exit 1 hibával leállt; manager KyLogic http_400 választ kap. Frissítés 86b805b3 running, magyar v2 recept nem igazolt. Blokkoló: telepítési hiba pontos oka, KyLogic-kapcsolat/recept; próba nem indult.

- [x] Videógyár B forrás-előkészítés: külön univerzális v2 szerződés és készítő, képkockás zónaellenőrzés, előpróba, folytatható sorozat, részletes események, önellenőrzés; 109 gyári + 15 meglévő szakmai/diagnosztikai próba sikeres, német/finn szöveg valódi böngészős tördelésével, gyártás nélkül.
- [ ] Videógyár B teljes elfogadás: VPS telepítés és self_check még nincs igazolva; KyLogic új parancsai és védett QA-megtekintője másik projektben ellenőrizendő; valódi vágási próba még szükséges.
- [ ] Videógyár B éles próba: valódi VPS-es magyar preview/trial, régi archívum és nyugta checksum-egyezése, további 26 nyelv csak tulajdonosi jóváhagyással. Blokkoló: publikálás, KyLogic új recept/parancs és jóváhagyás.

- [x] Cambridge feliratjavító v2: külön exam-promo-profiles-safe-v2 kiadás, ellenőrzött felirathatárok, régi renderelők és archívum változatlan; 73 gyártó- és 7 diagnosztikai próba sikeres, gyártási parancs nélkül.
- [ ] Cambridge feliratjavító v2 VPS-igazolása: Brain publikálása után tényleges image ID és friss életjel szükséges; új HU próbát csak KyLogic külön v2 receptje indíthat.

- [x] Cambridge-próba hiba (18:24 UTC): a configban jegyzett Docker-kép (sha256:8e19866f…) nem létezik a szerveren, returncode 125. prepare-exam-renderer.sh helyreállítása: eltűnt kép esetén újrajegyzés engedélyezett, meglévő képnél immutable_renderer_conflict marad; 3 új teszt OK.
- [ ] Cambridge helyreállítás VPS-igazolása: c002a9b1-2a17-4e4f-ad69-e663535d6e7b frissítés pending; Brain Publish kell, hogy a javított telepítő a szerverre kerüljön. Utána KyLogic retry a 9e275ddd próbára. Sorozat nem indítható.

- [x] v1.4 hozzáférési javítás beépítve az eddigi hibajelentés, betűk és nyelvi korlátok megtartásával; meglévő recept is javul renderelés előtt, archívum változatlan.
- [x] v1.4 VPS-átvétel: a4d95270 frissítés 10:47 UTC-kor sikeres, videógyár 10:22 UTC-kor új változattal újraindult, aktív.
- [ ] Japán újrapróba: 13:34 UTC-ig a szerver nem kapott/futtatott új japán renderelést (utolsó hiba a 10:12-es); KyLogic retry parancsának tényleges kézbesítése szükséges. Sorozat nem indítható.

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

- [x] Videógyár leállása (start-limit-hit, 20:15): a frissítés utáni sok egymás utáni tervezett újraindítás okozta; aktiválások sorba állítva, tervezett újraindítás előtt számláló nullázva; v3-előkészítés naplója bekerült a jelentésbe; 127+15 teszt OK
- [x] Videógyár újraindulásának és a v3 videókészítő sikeres elkészültének igazolása a szerverjelentésből; blokkoló: Brain publikálása szükséges
- [x] Goethe B2 profil: exam-promo-profiles-safe-v4 készítő (v3-másolat, csak examProfiles.ts új), engedélylista + deploy-blokk + 6 új próba, 133 teszt OK; gyártás nem indult
- [ ] v4 szerveres telepítésének és önellenőrzésének igazolása életjelből; blokkoló: Brain publikálása szükséges
