# Brain → KyLogic: hét történet, 26 további nyelv

Dátum: 2026-11-22

## Állapot — ezt ne tekintsétek VPS-telepítési igazolásnak

A külön többnyelvű készítő és a hozzá tartozó ellenőrző elkészült a Brain forrásában. **VPS-telepítés és új képdigest még nincs igazolva.** Receptet nem regisztráltunk, gyártást és fizetős narrációt nem indítottunk. A tulajdonos a hét magyar v2 videó jóváhagyását közölte a kérésben; az archivált nyugták tényleges meglétét minden sorozatindításkor ellenőrzi a VPS.

A tulajdonos 19:01 UTC-kor ehhez a sorozathoz kifejezetten engedélyezte az orosz és kínai nyelvet is. Más munkához vagy kampányhoz ez nem oldja fel a korábbi piaci kizárást.

## Az új, elkülönített kiadás

- Készítő: `seven-stories-i18n-safe-v1`.
- Szerződés: `kylo-seven-stories-i18n-v1`, recept `schema_version: 1`, `version: v1`.
- Hét recept: `seven-stories-hajo-series`, `seven-stories-auto-series`, `seven-stories-repulo-series`, `seven-stories-ust-series`, `seven-stories-szamlatorony-series`, `seven-stories-hatizsak-series`, `seven-stories-malacpersely-uj-series`.
- Kötelező, rendezett nyelvlista: `en de nl fr ja es pt it ko pl no sv cs tr sk sl da fi ar hi sr ru ro hr el zh`.
- Történetenként 26 videó és 78 ellenőrzőösszeges adatfájl; összesen 182 videó.
- A magyar v1/v2 készítő, média, receptek és nyugták változatlanok. Külön új kép épül a változatlan, jóváhagyott magyar kép fölé: `sha256:2fad84eb73bfd8938228f09bb52139001e667c445d80a8a93aab19d035acfddb`. Betűtelepítés nincs: a közös Noto core+CJK készletet örökli.
- A régi magyar készítő másik receptjeinek elfogadási szabálya nem bővül ki.

## Egyetlen összevont átadás

A mellékelt JSON a mezőlistát, pontos parancsformátumokat, archívumcélt és rögzített szabályokat tartalmazza. A csomagban lévő `tools/seven_series.py` a tényleges gépi ellenőrző, a `tools/seven_series_export.py` az adatösszeállító: a JSON időzítését nem kell kézzel másodszor kiszámítani. Nincs telepítő, hálózati hívás, receptregisztráció vagy gyártási indítás ebben az átadócsomagban.

A csomag Python-forrásait KyLogic saját ellenőrzött környezetében használja; a VPS médiacsatornájára kizárólag a létrejött adatokat küldje, futtatható kódot ne.

## KyLogic helyi adat-előkészítése

Minden `<story>/<language>/` könyvtárban:

1. `narration.mp3`: teljes eredeti, természetes tempójú narráció, újrahasználható gyorsítótárból. Meglévő hangot nem generálunk újra; az új fizetős hangok költségjóváhagyása KyLogic feladata.
2. `alignment.json`: pontosan `characters`, `character_start_times_seconds`, `character_end_times_seconds`; három azonos hosszúságú lista, növekvő kezdőidőkkel, a teljes hangon belül. Az end érték itt abszolút végidő, nem időtartam; más szolgáltatás relatív időtartamát egyszer át kell alakítani.
3. `timeline.json`: pontosan `sceneFrames`, `audio_duration_us`, `subtitles`, `cta`, `slogan`, `tool_labels`.

`sceneFrames`: hét pozitív egész képkockaszám, 30 fps. A hét jelenet időtartama az adott nyelv narrációját kövesse. A hetedik jelenetben a beszéd után legalább 2 teljes másodperc maradjon. Az összeállító ebből számolja a `timing` és `duration_ms` mezőt, Python kerekítéssel; KyLogic ezt az összeállítót használja, ne írjon párhuzamos időzítési képletet.

`audio_duration_us`: teljes natív mintavételezésű dekódolt PCM mintaszám / mintavételezés, mikromásodpercre kerekítve. MP3 konténerhosszt nem fogadunk el; 2 ms mérési tűrés marad.

`subtitles`: rendezett, nem átfedő `{start_ms, end_ms, text}` elemek, egész milliszekundummal; a teljes hang idején belül. Az utolsó előtti szöveg pontosan `kylo.study`; az utolsó a helyi szlogen. A `kylo.study` felirat kezdete már a hetedik jelenetben legyen. A hosszú mondatokat olvasható feliratrészekre bontsátok.

`cta`: a „Próbáld ki ingyen 14 napig!” helyi fordítása. `slogan`: az „A te AI magántanárod” helyi fordítása. `tool_labels`: a jegyzet, tanulókártyák, magyarázat, gyakorlás négy helyi megnevezése, ebben a sorrendben. A számérték külön `trial_days: 14` szabállyal is kötött; a fordítás értelmét KyLogic tartalmi ellenőrzése igazolja. A gyár a megadott szöveg minden karakterét, megjelenítését és elhelyezkedését ellenőrzi, de nem állít szemantikai fordításellenőrzést.

Arabnál `rtl`, a többi nyelvnél `ltr` automatikus. A domain minden nyelvnél latin betűkkel marad.

`hu-anchors.json`: hét kulcs (`hajo`, `auto`, …), mindegyik értéke az adott befejezett magyar v2 teljes nyugtájának kanonikus SHA-256-a. A nyugta összes mezője számít, beleértve a `media` és `schema_version` részt is. Nem elegendő csak az MP4 hash-e.

Futtatás az átadócsomag könyvtárából, Python 3 + ffmpeg + ffprobe mellett:

```bash
python3 tools/seven_series_export.py \
  --inputs /sajat/het-tortenet-26-nyelv \
  --anchors /sajat/hu-anchors.json \
  --output /sajat/het-tortenet-export-v1
```

A bemenetek változatlanok maradnak. Az eredmény hét recept-JSON és a receptekben hivatkozott pontos adatfájlok. Ismételt futás ugyanazokat a fájlokat elfogadja, eltérő bájtokkal nem ír felül semmit. A szerződés szerinti állománykorlát 40 MiB/fájl és 600 MiB/történet. Az összeállító teljes hangdekódolást és igazításellenőrzést végez, gyártást nem.

## Sorrend és engedélyezési kapuk

1. **Sándor** egyszer publikálja a Brain frissítést, hogy az új készítő telepítési kérése eljusson a VPS-re.
2. **Brain** a védett állapotjelentésből vagy a lentebbi tulajdonosi olvasópróbából igazolja az új kép és a kezelő átvételét. Amíg ez hiányzik, KyLogic ne indítson gyártást.
3. **KyLogic** összeállítja, helyben ellenőrzi, majd `register_recipe` paranccsal regisztrálja mind a hét teljes, 26 nyelvű receptet. Ez még nem sorozatengedély. A fájlok kizárólag a meglévő ellenőrzőösszeges adatcsatornán érkezhetnek.
4. **KyLogic** egyetlen közös `self_check` parancsot küld a JSON pontos formátumával. Ez mind a 182 bemenetet, mind a hét magyar archívumnyugtát, a képet, a megosztott betűk karakterlefedését, tárhelyet és régi készítőket ellenőrzi. Hibánként csak rögzített lépés és engedélylistás kód vagy kivételosztály kerül ki; nincs nyers bemenet vagy hitelesítő adat.
5. A sikeres `self_check` esemény visszaigazolását KyLogic adja. A parancs eredményének vagy egy régebbi magyar self-checknek a visszaigazolása nem helyettesíti ezt. `preflight_event_id` a sikeres teljes ellenőrzési esemény azonosítója.
6. **KyLogic** tulajdonosi jóváhagyással, az adott recept hash-ével és annak eredeti magyar v2 nyugtahash-ével kötött `start_series` parancsokat küld, hajóval kezdve. A gyár új feladatot csak az ACK után fogad el. Hét külön feladat; a készítőben egyszerre egy videó, ötös ellenőrzőpontok. A következő történetet az előző sikeres befejezése után indítsátok: `hajo → auto → repulo → ust → szamlatorony → hatizsak → malacpersely-uj`.
7. Bármelyik sorozat hibája, blokkolása vagy szüneteltetése a többi ilyen sorozat felvételét is megállítja. Automatikus hibaújrapróbálás nincs. Az ismételt indítóparancs nem hoz létre második feladatot; újraindítás után a meglévő nyugták megőrzésével folytatódik.

Az input self-check `ok:true` értéke csak előfeltétel. A valódi kimeneti QA minden videónál külön, archiválás előtt fut: teljes dekódolás, változatlan 0-indulású hanghullám, az összes tényleges képkocka szöveg-/tárgyhatára, átfedés, helyi CTA és zárókép. Hibás vagy hiányzó bizonyíték nem kerülhet archívumba. A gyár nem indít közösségi publikálást.

## Tulajdonosi VPS-átvételi olvasópróba publikálás után

Ez meglévő fájlokat és a készítőképet ellenőrzi, gyártást nem indít. Ha bármelyik állítás elbukik, álljatok meg, az eredményt küldjétek vissza Braintől javításra.

```bash
sudo python3 - <<'PY'
import json,sys,subprocess,hashlib
from pathlib import Path
root=Path('/opt/kylo-video-factory/current').resolve()
sys.path.insert(0,str(root))
import seven_series as s
import seven_series_state,seven_series_preflight,seven_series_media
c=json.loads(Path('/etc/kylo-video-factory/config.json').read_text())
a=json.loads(Path('/etc/kylo-video-factory/reviewed-renderers.json').read_text())
r=c['renderers'][s.RENDERER]
assert r==a[s.RENDERER] and r['reviewed'] is True and r['scenes']==s.SCENES
assert subprocess.check_output(['docker','image','inspect','--format','{{.Id}}',r['image']],text=True).strip()==r['image']
assert s.contract_export()['total_videos']==182
for name in ('seven_series.py','seven_series_media.py','seven_series_preflight.py','seven_series_state.py'):
    assert (root/name).is_file()
print(json.dumps({'seven_series_install_ok':True,'contract_id':s.CONTRACT_ID,'image':r['image'],'languages':list(s.LANGUAGES),'total_videos':182,'render_started':False}))
PY
sudo python3 /opt/kylo-video-factory/current/self-check-only.py
```

A második parancs teljes szerveres készítő/tárhely-önellenőrzést és kizárólag a saját eredményének KyLogic-átadását végzi; a 182 bemenet közös ellenőrzése később, regisztrálás után történik.

## Ellenőrzési bizonyíték a helyi előkészítésről

- 384 videógyári Python-próba sikeres, ebből 31 új sorozatpróba.
- 7 védett állapotjelentési próba sikeres.
- 504 valódi böngészős kompozícióminta kilenc nyelven és hét történeten: arab, hindi, japán, koreai, egyszerűsített kínai, cirill és görög is; nem találtunk határkilógást vagy átfedést. 27 mintakép szemrevételezve. Ezek mintafordítások, nem a még hiányzó végleges 182 fordítás jóváhagyásai.
- A teljes adatösszeállítás 182 elemen valódi dekódolással és ismételt futással kipróbálva, kizárólag ideiglenes teszthanggal. Nem narráció és nem kész videó.
- Telepítőszintaxis és ellenőrzőösszegek sikeresek; a korábbi magyar készítő forrásai és receptjei változatlanok.
- **Hátravan:** VPS-telepítés, friss teljes self-check/ACK, KyLogic fordítások és hangok, közös 182-es előellenőrzés/ACK, majd a végleges MP4-ek és archívumnyugták QA-ja.
