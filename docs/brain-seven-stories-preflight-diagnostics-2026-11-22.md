# Brain → Sándor / KyLogic: hét történet — pontos hibafeltárás szükséges

## Igazolt eredmény

- A VPS 2026-11-22 15:57:10 UTC-kor átvett életjelében a 15:53:15 UTC-s előellenőrzés valóban mind a hét történetnél hibás. Mind a 21 checksum egyezik; `input_ok:false`, `preparation_ok:false`, `render_started:false`.
- A teljes régi önellenőrzés sikeres, mind a 11 készítő elérhető. A hét történet képe változatlan: `sha256:2fad84eb73bfd8938228f09bb52139001e667c445d80a8a93aab19d035acfddb`.
- Az eredeti csomag mind a 21 változatlan fájljával helyben a csomagbeli ÉS a tényleges regisztrált könyvtárszerkezetben mind a hét bemenet átmegy. Nem indult videógyártás.

**A hiányzó program, jogosultsághiba vagy sikertelen hangdekódolás egyelőre feltételezés, nem igazolt ok.** A jelenlegi kód a programindítástól az outro-ellenőrzésig minden hibát ugyanazzal a kóddal fog össze; ráadásul a már sikeres hangdekódolást is kihagyottnak jelölheti egy későbbi hiba miatt.

## Elkészült célzott jelentési javítás

A forrásban elkülönül a hangvizsgálat, időtartam, teljes dekódolás, karakterigazítás, felirat és outro lépése. A hibához csak a lépés, kivételosztály, kilépési kód/errno és rögzített ok kerül; nincs nyers hibaüzenet, stderr, titok vagy letöltési cím. A már teljesített ellenőrzés többé nem „kihagyott”. Az elfogadási feltételek változatlanok, a hibás bemenet továbbra is blokkolja a próbát.

Ez **nem az alapul szolgáló VPS-hiba igazolt javítása**, és **még nem települt**. Egyelőre nem kell újabb publikálás: az alábbi csak olvasó parancs a jelenlegi telepített ellenőrző pontos kivételét is megmutatja.

## Következő lépés — Sándor

Az SSH-ablakba másold be az egész következő blokkot, a záró `PY` sorral együtt, majd küldd vissza a kimenetet. Nem módosít konfigurációt, receptet, állapotot, archívumot vagy szolgáltatást; nem indít videót és nem küld gyártási parancsot. A hangot csak dekódolja ellenőrzéshez.

```sh
sudo python3 - <<'PY'
import sys, json, math
from pathlib import Path
base = Path('/opt/kylo-video-factory/current').resolve()
sys.path.insert(0, str(base))
import seven_preflight
failures = []
allowed = {'seven_audio_duration', 'seven_alignment_invalid', 'seven_subtitles_invalid', 'seven_outro_speech_outside_outro'}
def trace(frame, event, arg):
    if frame.f_code is seven_preflight.run.__code__ and event == 'exception':
        _, error, _ = arg
        row = {'story': frame.f_locals.get('story'), 'line': frame.f_lineno, 'exception': type(error).__name__}
        for key in ('errno', 'returncode'):
            value = getattr(error, key, None)
            if isinstance(value, int): row[key] = value
        if isinstance(error, ValueError) and str(error) in allowed: row['reason'] = str(error)
        seconds = frame.f_locals.get('seconds')
        if isinstance(seconds, (float, int)) and math.isfinite(seconds): row['probed_duration_us'] = round(seconds * 1000000)
        failures.append(row)
    return trace
sys.settrace(trace)
try:
    result = seven_preflight.run('/var/lib/kylo-video-factory/recipes', '/etc/kylo-video-factory/config.json', registered=True)
finally:
    sys.settrace(None)
print(json.dumps({'observed_at': result['observed_at'], 'input_ok': result['input_ok'], 'preparation_ok': result['preparation_ok'], 'render_started': result['render_started'], 'failures': failures, 'stories': result['stories']}, ensure_ascii=False, indent=2))
PY
```

## Következő lépés — Brain és KyLogic

**Brain:** a fenti szerveres eredmény alapján javítja az igazolt okot, és csak utána kéri a szükséges egyszeri telepítést és friss teljes ellenőrzést. Sikeres `input_ok:true`, `preparation_ok:true` és tényleges KyLogic-átvétel most még nem igazolható.

**KyLogic:** a hét receptet ne regisztrálja újra, egyelőre ne indítson próbát. Sikeres, friss előellenőrzés és átvétel után hét külön HU próba, sorosan: hajó → autó → repülő → üst → számlatorony → hátizsák → új malacpersely. Sikertelen próbánál megállás és hibajelentés; nincs automatikus ismétlés, sorozat, más nyelv, új narráció vagy közösségi publikálás.