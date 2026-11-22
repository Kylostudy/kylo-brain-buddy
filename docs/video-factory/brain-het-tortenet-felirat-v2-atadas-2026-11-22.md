# Brain → KyLogic: hét magyar történet – kylo.study feliratjavítás

## Elkészült, helyben ellenőrizve

A kizárólag pontos `Kylo pont study.` vagy `Kylo pont study` felirat most `kylo.study` alakban jelenik meg. A javítás mind a hét történetre közös, csak a megjelenítést érinti. Az eredeti feliratadatok és a narráció változatlanok.

- 344 videógyári teszt sikeres.
- Mind a hét történet eredeti hibás v1 és javított v2 felirata valódi böngészős képen ellenőrizve.
- 163 további képkockavizsgálat (feliratok és jelenethatárok), 177 mért képkockajelentés: nincs zónakilógás, átfedés vagy böngészőhiba.
- Az eredeti készítő teljes forrása, ellenőrzői, hét v1 receptje és jóváhagyott médiahash-jei bájtra változatlanok.
- Ez helyi képkocka-ellenőrzés, nem teljes VPS-videógyártás vagy végleges MP4-ellenőrzés.

## Miért új receptverzió?

A meglévő v1 próbák már elkészültek. Ugyanaz a v1 kérés a meglévő nyugtát adná vissza, nem új videót. Ezért új **v2** receptek szükségesek; ugyanazok a receptazonosítók, renderer és jelenetek, kizárólag a legfelső `version` változik `v1`-ről `v2`-re. Sem a videóazonosító, sem a jelenetazonosító nem változik.

Az új kimeneti kulcs: `<recipe_id>/v2/<video_id>`. A v1 archívum és nyugták érintetlenek. A gyár új v2 munkát hoz létre, az ismételt v2 kérés nem hoz létre második munkát.

## Képdigest és biztonsági kötés

Nincs képcsere vagy új Docker-képdigest. A továbbra is használt, korábban igazolt kép:

`sha256:2fad84eb73bfd8938228f09bb52139001e667c445d80a8a93aab19d035acfddb`

A v2 három új, checksum-pinnelt, csak olvasható javítófájlt használ a már meglévő hanghossz-javítás mellett: `seven_caption_v2.py`, `seven_caption_index_v2.ts`, `seven_caption_timing_v2.ts`. Csak a hét pontos HU v2 recept + a fenti kép + az eredeti hét jelenet + helyi reviewed jóváhagyás fogadható el. Hiányzó, írható vagy eltérő checksumú javítófájl esetén a gyár megáll.

A v1 továbbra is kizárólag az eredeti hanghossz-javítást kapja. A feliratjavítás nem kapcsolható be v1 receptekre.

## KyLogic feladata a szerveres átvétel után

A mellékelt `kylo-het-tortenet-hu-felirat-v2-szerzodes.json` tartalmazza mind a hét teljes, pontos regisztrációs payloadot a `recipes` listában, a kanonikus recept-SHA256-okat, a javítóhash-eket és az engedélyezett műveleteket.

1. Csak igazolt Brain-telepítés után regisztráljátok mind a hét v2 receptet, a JSON-ban szereplő adatokat változtatás nélkül használva. A három eredeti médiafájlt v2 bemeneti könyvtárba kell ellenőrzött adatfogadással eljuttatni; v1 bemenetet nem szabad átnevezni vagy módosítani.
2. A gyár regisztrálás után automatikusan v2 közös előellenőrzést küld. Az utolsó recept regisztrálása után mind a hét v2 bemenetnek jelen kell lennie: `version:v2`, `contract_id:kylo-seven-stories-hu-caption-v2`, `input_ok:true`, `preparation_ok:true`, megfelelő digest és javítóhash-ek. Az esemény ACK-ját igazoljátok.
3. Az előellenőrzés `ok:false` maradhat a még hiányzó készvideó-QA miatt; ez NEM azonos az `input_ok`/`preparation_ok` sikertelenségével. Gyártási QA csak az elkészült videók után bizonyítható.
4. Csak sikeres előellenőrzés és ACK után hét külön HU v2 próba, sorosan: **hajo → auto → repulo → ust → szamlatorony → hatizsak → malacpersely-uj**. Minden befejezett próbánál végleges MP4-visszaolvasás, változatlan beszéd ellenőrzése és képkockánkénti zónaellenőrzés szükséges; hiba esetén álljatok meg, automatikus újrapróba nélkül.

### Parancsok

A meglévő aláírt parancsboríték változatlan: `schema_version:1`, friss UUID `delivery_id`, `operation`, `payload`.

- `register_recipe`: `payload` = a szerződés `recipes` listájának megfelelő teljes eleme.
- `trial`: például `payload:{"recipe_id":"seven-stories-hajo-hu-trial","version":"v2"}`.
- Új capability: `seven-stories-hu-caption-v2`; a v1 capability megmarad.

Nincs más nyelv, start_series, közösségi publikálás, új TTS, hangvágás vagy gyorsítás. Indulás 0 ms, tempó 1.000×, sceneFrames/zóna/CTA/animáció/fekete zárókép változatlan.

## Következő lépés és jelenlegi korlát

**Sándor:** egyszer publikálja a Braint, mert csak így jut a javítás a VPS-re; ez önmagában nem gyártási engedély. Utána a következő csak olvasó ellenőrzés kimenetét küldi Brainnek:

```bash
sudo python3 - <<'PY'
import sys, json, subprocess
from pathlib import Path
root = Path('/opt/kylo-video-factory/current').resolve()
sys.path.insert(0, str(root))
import seven_caption_v2 as v2
import seven_stories as v1
from seven_audio_runtime import audio_mounts, REVIEWED_IMAGE
config = json.loads(Path('/etc/kylo-video-factory/config.json').read_text())
reviewed = json.loads(Path('/etc/kylo-video-factory/reviewed-renderers.json').read_text())
r = config['renderers'][v1.RENDERER]
assert r == reviewed[v1.RENDERER]
assert subprocess.check_output(['docker','image','inspect','--format','{{.Id}}',r['image']],text=True).strip() == REVIEWED_IMAGE
for story in v1.STORIES:
    assert len(audio_mounts(v2.template(story),r)) == 8
    assert len(audio_mounts(v1.template(story),r)) == 4
print(json.dumps({'caption_v2_install_ok':True,'image':r['image'],'contract_id':v2.CONTRACT_ID,'stories':list(v1.STORIES),'render_started':False}))
PY
```

**Brain:** ellenőrzi a visszakapott eredményt. **KyLogic:** csak ezután regisztrál és előellenőriz. Az új receptek regisztrálása után szükség esetén külön diagnosztikai ACK küldhető, videóindítás nélkül:

```bash
sudo python3 /opt/kylo-video-factory/current/self-check-only.py --seven-stories --version v2
```

Új sikeres VPS-előellenőrzést és KyLogic-ACK-et ebből a munkakörből még nem állítunk: a v2 telepítése és bemeneteinek regisztrációja hátravan. Sem receptregisztrációt, sem videót, sem sorozatot nem indítottam.
