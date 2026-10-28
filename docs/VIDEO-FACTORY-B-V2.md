# Videógyár B — KyLogic átadás

Állapot: új forrás és tesztek, nem igazolt VPS-telepítés. A csomag és a szolgáltatás telepítése nem indít gyártást. Az új vizuális sablon első előpróbája és tulajdonosi szemrevételezése még szükséges; a régi videók és receptek változatlanok.

## Kapcsolat

Megmarad a `VIDEO-FACTORY-KYLOGIC-V1.md` szerinti kifelé kezdeményezett `/claim`, `/events`, `/heartbeat`, `/assets` HMAC-kapcsolat. Szállítási válasz és eseményboríték továbbra is schema_version=1; az új parancs és adat-recept schema_version=2. Új capabilities: `universal-exam-v2`, `series-run-v2`, `layout-qa-v2`. KyLogic csak ezek hirdetése után küldje az új parancsokat. A KyLogic másik projektjének parancsfogadása és tulajdonosi ellenőrzése külön ottani változtatás/igazolás.

## Recept

Kötelező: `schema_version:2`, `recipe_id`, `version`, `renderer:"exam-promo-universal-v1"`, `exam`, `safe_zone`, `languages`, `files`, `videos`. Opcionális `completed:[{language,receipt}]`: csak visszaellenőrzött régi videónyugták. A recept nyelveinek nem kell pontosan 27-et lefedniük; a sorozatparancs kérheti a 27 alapnyelvet. A hiányzó fordításokat/anyagokat a gyár összesítve jelzi.

`safe_zone:{left:65,right:950,top:231,bottom:1459}` egyetlen helyen, receptadatként. Az `exam` mezői: `name` (változatlan vizsganév), `sections:[{name,time,example}]`, `score_scale`, `sample_percent`, `vocabulary:[szavak]`, `skin:{background,foreground,accent,muted}` hatjegyű hex színekkel. Kezdő adatprofilok: `exam-profiles-v2.json`; mintaeredményük demonstrációs adat, a végleges receptet KyLogic adja.

`files:[{key,bytes,sha256}]`: a meglévő 256 KiB darabos transzfer, maximum 40 MiB/fájl és 600 MiB/csomag. Nincs kód, telepítő, távoli cím vagy titok a receptben.

Videónként: `video_id`, `language`, `audio`, `alignment`, `font`, `dog` ellenőrzött fájlkulcsok; opcionális `bed`; `scenes`, `cta`, `telegram`, `outro_ms`. Minden szükséges karakter legyen a recept betűjében. `alignment` JSON-lista: `{character,start,end}` másodpercben, ahol `end` időhossz, nem abszolút záróidő.

Hét jelenet sorrendben: `pressure`, `dry_answer`, `understanding`, `questions`, `simulation`, `feedback`, `cta`; utána fekete outro. Mindegyik: `{kind,heading,body,weight,forbidden:[{left,right,top,bottom}]}`. A pozitív súlyok a tényleges narráció hosszát osztják fel. A sablon saját központi képe számára külön fenntartott téglalapot is ellenőriz. A régi IELTS/Cambridge-kódot nem alakítja át és nem gyártja újra.

## Parancsok

Boríték: `{schema_version:2,delivery_id:UUID,operation,payload}`. Azonos kézbesítés azonos eredményt ad; új UUID új feladatot jelent. Újrapróbához `retry`, nem új `series_run` szükséges.

- `register_recipe`: payload a fenti recept; anyagok ellenőrzött átvétele után regisztrálás és `self_check`.
- `preview`: `{recipe_id,version,languages?:[...]}`; csak jelenetképek, nincs végleges MP4. Nyugtával kész nyelv alapból kihagyva.
- `trial`: `{recipe_id,version,languages:["hu"]}`; pontosan egy nyelv, előpróba és teljes ellenőrzés után új verziójú MP4.
- `series_run`: `{recipe_id,version,languages?:[...],approval,rerender?:[...]}`; alaplista: EN DE NL FR JA ES PT IT KO PL NO SV CS TR SK SL DA FI AR HI SR RU RO HR EL HU ZH (kisbetűs kódok).
- `rerender`: ugyanaz, de kötelező kifejezett `rerender` lista; az érintett nyelvek a `languages` listában is szerepeljenek. Új cél mindig `<recipe>/<version>_v<timestamp>_<suffix>/<video>`; régit nem ír felül.
- `pause`, `resume`, `retry`, `cancel`, `status`, `logs`: `{job_id}`. Szünet/lemondás az aktuális videó után; nincs archívumtörlés. Három sikertelen próbálkozás után nincs automatikus újrapróba.
- `inventory`: `{}`; kis összesítés nyugtákkal, jobállapotokkal. Tárhelyadat a `self_check` eseményben.
- `qa_fetch`: `{job_id,language,artifact?:"contact"|"layout"|"video"}`; védett referenciák és checksumok.

`approval`: `{approval_id:UUID,recipe_sha256,trial_receipt_sha256,approved_at:unix_seconds,owner_authorized:true}`. A konkrét immutábilis recepthez és az abból készült, teljesen ellenőrzött próbanyugtához kötött. **A webes tulajdonosi jogosultságot és a kifejezett döntést KyLogic ellenőrizze**; a VPS önmagában nem tud személyazonosságot igazolni.

Késznek számít a receptcsalád+nyelv ellenőrzött nyugtája, receptverziótól függetlenül. Új tartalommal új példányhoz explicit rerender vagy új receptcsalád szükséges. Régi nyugtát csak a tulajdonos által hitelesített receptcsomag explicit `completed` hozzárendelése importálhat; ország, proxy vagy fájlnév alapján nem találgatunk.

## Esemény és QA

Tartós outbox, nyugtázás a meglévő szerződés szerint. `self_check`, `job_progress`, `video_verified`, `batch_verified`, `series_summary`, `final_error`, `command_result`. Hiba: `{stage,code,message,language?,scene?,file?,log_tail:[legfeljebb 200 kitakart sor]}`. Média nem kerül az eseménybe.

Képek és layout VPS-en, fix `.contact.jpg` / `.layout.jsonl` utótaggal. Referencia `videos/versioned-factory/...`; letöltés a meglévő **HMAC-védett** `/api/public/cross/kylogic/archive-file?path=...` úton. Ezek nem nyilvános böngészőlinkek: KyLogic hitelesített letöltése/megtekintője szükséges. `qa_fetch` nyugtát ad, nem kikerüli a letöltési hitelesítést. A QA-képek nem helyettesítik a tulajdonosi tartalmi döntést.

## Telepítés és elfogadás

Checksumos, külön rögzített készítő, új helyi állapottáblák és változatlan régi állapot. `prepare-universal-renderer.sh` csak előkészít és aktivál, nem küld gyártási parancsot. Aktív videó készítését a telepítés nem szakíthatja meg.

Sorrend: Brain változás publikálása → VPS automatikus frissítés → új `self_check` és tényleges `exam-promo-universal-v1` image igazolása → KyLogic regisztrálja az új magyar receptet a meglévő hanggal → külön magyar `preview` → tulajdonosi szemrevételezés → külön `trial` → tulajdonosi jóváhagyás → a további 26 nyelv `series_run`.

Még igazolandó: valódi VPS-es előpróba és teljes videó, régi archívum/nyugták checksum-egyezése, KyLogic új parancsainak és képes megtekintőjének fogadása. A helyi tesztek ezt nem állítják késznek.

Vágás: kizárólag frozen+silent metszet, narrációs/CTA/outro védelemmel, képkockahatáron befelé kerekítve. A megtartott képkockákhoz új layout-indexek és feliratidők készülnek; a jelenetképek védett szöveges szakaszai változatlanok. Új dekódolás, 100 ms-os időeltérés-korlát és ismételt hézagellenőrzés után archiválható. A forrásfájl és az archívum érintetlen; csak munkapéldányt kódol újra. Valódi VPS-es vágás még igazolandó.