# Brain → KyLogic: hét történet v2 renderhiba javítása

2026-11-22; szerződés: `kylo-seven-stories-hu-caption-v2`.

## Mind a hét hiba igazolt
A védett VPS-életjel korábbi példányainak visszaolvasása mind a hét megadott jobra ugyanazt igazolta: `seven_caption_missing`. A legutóbbi 18:01:21 UTC-s életjel a malacpersely-uj job hibáját tartalmazza.

A konténer már elkészítette az MP4-et és a képkockánkénti mérést, majd a régi `seven_media.py` ellenőrző a narrációban szereplő „Kylo pont study.” szöveget kereste a javított „kylo.study” felirat helyett. A figyelmeztetés a csak olvasható webpack-cache-ről nem a leállás oka: a folyamat eljutott a végső médiaellenőrzésig.

## Javítás
- Külön `seven_media_v2.py`: kizárólag a hét változatlan jóváhagyott videóadatot fogadja, másolatban vetíti a két pontos feliratformát „kylo.study”-ra, és minden hang-/képkocka-/határ-/CTA-/outro-ellenőrzést a változatlan v1 ellenőrzőnek ad át.
- A v2 konténeradapter ezt hívja checksum-kötött, csak olvasható javítófájlként.
- A VPS archiválás előtti második ellenőrzése ugyanezt hívja kizárólag v2 esetén. Csak a konténer javítása nem lett volna elég.
- Mindkét telepítőlistába bekerült az új ellenőrző; a SHA256SUMS frissült.

**Változatlan:** a v1 ellenőrző és készítőforrás, képdigest `sha256:2fad84eb73bfd8938228f09bb52139001e667c445d80a8a93aab19d035acfddb`, összes recept, narráció, időzítés, betű, gépi titok, archívum és nyugta.

## Helyi bizonyíték és korlát
353 Python-teszt sikeres. Mind a hét teljes szintetikus mérési jegyzék (5214 képkocka összesen) átment v2-vel; ugyanazt a v1 ellenőrző a régi URL-elvárás miatt elutasítja. A hiányzó/hibás felirat, veszélyes határ, hiányzó képkocka és módosított hang/időzítés elutasítása is ellenőrzött. Ez nem új render és nem VPS-es sikerigazolás.

## Következő lépések
1. Sándor egyszer publikálja a Brain frissítést: azért kell, hogy a javított készítőadapter és mindkét végső ellenőrzés a VPS-re kerüljön. Ez nem videóindítás.
2. Telepítés után Sándor futtatja az alábbi csak olvasó ellenőrzést, és visszaküldi Brainnek. Ha megvannak a korábbi munkafájlok, a már elkészült hajó MP4 teljes hang-/képkocka-ellenőrzését is elvégzi; nem renderel, nem archivál.
3. Brain ellenőrzi az eredményt és a friss teljes self-checket. Addig KyLogic ne indítson új próbát.
4. Siker után KyLogic az eredeti v2 feladatok állapotához illeszkedő engedélyezett egyszeri retry-t használja; a már ellenőrzött archivált kimeneteket nem gyártja újra. Hajó először; csak annak sikeres archiválása/visszaolvasása után autó → repülő → üst → számlatorony → hátizsák → új malacpersely. Bármely hiba esetén megállás és jelentés, nem továbblépés vagy automatikus ismétlés. Nincs sorozat, más nyelv vagy közösségi publikálás.

## Csak olvasó VPS-próba
```bash
sudo python3 - <<'CHECK'
import sys, json
from pathlib import Path
root = Path('/opt/kylo-video-factory/current').resolve()
sys.path.insert(0, str(root))
import seven_caption_v2 as v2
import seven_stories as v1
import seven_media_v2 as media
from seven_audio_runtime import audio_mounts, REVIEWED_IMAGE
from storage import checksum
config = json.loads(Path('/etc/kylo-video-factory/config.json').read_text())
renderer = config['renderers']['seven-stories-hu-v1']
for story in v1.STORIES:
    mounts = audio_mounts(v2.template(story), renderer, root)
    assert any(m.endswith(':/app/validation/seven_media_v2.py:ro') for m in mounts)
print(json.dumps({'caption_v2_media_install_ok': True, 'image': renderer['image'], 'render_started': False}))
work = Path(config['work_root']) / '75d04da9-e4a5-41da-97e9-178202098e21' / '0'
recipe = Path(config['recipe_root']) / 'seven-stories-hajo-hu-trial' / 'v2'
video = v2.template('hajo')['videos'][0]
audio = recipe / video['audio']['vo']
output, layout = work / 'output.mp4', work / 'layout.jsonl'
if all(p.is_file() and not p.is_symlink() for p in (audio, output, layout)):
    assert checksum(audio) == video['timeline']['audio_sha256']
    result = media.verify(output, audio, layout, video)
    print(json.dumps({'hajo_existing_output_qa_ok': True, 'qa': result, 'archive_written': False}))
else:
    print(json.dumps({'hajo_existing_output_qa_ok': False, 'reason': 'scratch_files_unavailable', 'render_started': False}))
CHECK
sudo python3 /opt/kylo-video-factory/current/self-check-only.py
```
Hiányzó munkafájl nem gyártási hiba és nem felhatalmazás új renderre; ebben az esetben az ellenőrzéshez külön KyLogic-próba kell a telepítés igazolása után.

## Javított fájlok SHA-256
```text
bf6ef67474516903e731b382b598de2136dec103d45f373f7779f259808f717b  seven_media_v2.py
4cb87110d8529d1dea0bb3e0c9c35c67999dc8e7e0d19b5f25cc884c2a705ff1  seven_audio_runtime.py
4b2d7bd9c5870c4599f5f9e405cdd01fb2e18b225eacfb52f1daa7115a471042  seven_caption_index_v2.ts
042dfec39085c2e619eb7ac1074e413f11eaf558d0bb283d81b6298e46be2416  agent.py
e69dd4e4567d6f27d91f00f9ae1b0e693251c772b803b2929f24953927a22a58  install.sh
2ee60f8dadeb0782b38f64e747a50892235240fa3191f90c3dc232c2291cad2e  activate-manager.sh
```
