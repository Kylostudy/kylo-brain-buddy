# Malacpersely: előkészítés és KyLogic adatátadás

Készítő: `piggy-bank-safe-v1`. Jelenet: `piggy-bank-v1`. Receptazonosító: `malacpersely-hu-trial`, schema_version 1, series `other`, languages kizárólag `["hu"]`, pontosan egy videó. `start_series`, v2 `series_run` és `rerender` tiltott. A telepítés nem regisztrál receptet és nem renderel. A tényleges teljes Docker-képazonosító kizárólag VPS-telepítés után ismert.

## Belépési pont és input

Konténer: `bun /app/piggy-src/index.ts`. Csak olvasható `/request.json`: `{manifest, video}` (a video pontosan a manifest egyetlen videója). Checksum-ellenőrzött, symlink nélküli `/recipe`, írható `/work`, ideiglenes `/tmp`; nincs hálózat, UID 65532. H.264 yuv420p + AAC `/work/output.mp4`, minden képkocka tényleges szövegmérése `/work/layout.jsonl`. A meglévő gyár ellenőrzi/dekódolja és új, felül nem írható archívumhelyre teszi majd a később jóváhagyott próbát.

Pontos inputlista (kulcsoknak nincs kiterjesztés-pontja):
- `audio/vo-hu-mp3`: valódi, KyLogic által adott magyar hang.
- `data/scene-frames-json`: inert JSON `{ "sceneFrames": [hét pozitív egész képkockaszám] }`; nincs futtatható kód vagy kész master-videó.
- Opcionális `audio/bed-mp3`: meglévő, jogtisztán használható aláfestés. Új hang/szolgáltatás nincs.

A márkalogó a lokálisan átvizsgált kép része; távoli recept nem cserélheti. Betűk a már telepített v4/v3 teljes képazonosítóhoz kötött alapból öröklődnek, nincs újratelepítés.

## Videómezők

- `width`:1080, `height`:1920, `language`:hu, `scene`:piggy-bank-v1.
- `audio`:audio/vo-hu-mp3, `master`:data/scene-frames-json.
- `timing`: hét egymáshoz illeszkedő `{start_ms,end_ms}` ablak, 0-tól `duration_ms`-ig; 30 fps képkockahatár legközelebbi egész milliszekunduma. Az adatfájl jelenethosszai pontosan ugyanezt jelentik. Maximum 18000 képkocka, pozitív véges egész értékek; hibás lista megállítja a készítőt.
- `text`: JSON-kódolt objektum, pontos kulcsok: heading, disclaimer, truth, price, steps (4 szöveg), counter_values (`[20,35,55,80,105]`), labels (5 kategória), outro_url, outro_tagline. Ár `29,99 USD/hó`, végösszeg `Több mint 100 USD/hó`, disclaimer `Szemléltető előfizetési kosár. A tényleges díjak eltérhetnek.`
- `subtitle`: JSON-kódolt `{subs:[{start_ms,end_ms,text}]}`; egymást nem fedő, igazított feliratok, maximum 180 karakter/darab, a hatodik jelenet végéig. A hetedik fekete márkazárás néma.
- `cta`: JSON-kódolt `{text:"Próbáld ki ingyen!",supporting_text:"14 napos ingyenes próba",trial_days:14}`.
- Nincs távoli font, kép, CSS, URL, telepítő vagy kód; ismeretlen input elutasítva.

Ez **sémaleírás, nem éles recept**: nincsenek kitalált fájlméretek, checksumok, nyugták vagy jóváhagyások. KyLogic a valódi hang után adhatja az időzítést és a checksumos manifestet. A 39 másodperces tervezet és a 40 másodperces brief nem végleges hossz.

## Tervezet ellenőrzése

A forráscsomag hét checksumja egyezik. A draftból: cím/folyamatfelirat y=150 és felirat y=1480 kívül volt a 231–1459 zónán; új helyi réteg ezeket belülre helyezi, töri/méretezi és minden képkockán méri. A számláló csak az 1–2., végösszeg csak a 3. jelenetben él, ezért nincs időátfedés. Szövegblokkok nem fedhetik egymást. A fő jelképek helyét a helyi tervezetben az overlay számára igazítottuk; tényleges vizuális jóváhagyás csak későbbi VPS-próba után lehetséges. Az upload open_items sorában szereplő 10 USD elírás: jóváhagyott második díj 15 USD, összeg 105.

## Átadás és korlát

Előkészítő: `prepare-piggy-renderer.sh`, egyező v3/v4 registry/config, telepített Noto core+CJK és teljes digest ellenőrzés, kizárólag új registry-elem. Foglalt eltérő készítőazonosító elutasítva. Meglévő gyári aktiválás és induláskori teljes self_check esemény jut a hitelesített outboxon KyLogicnak; siker csak tényleges VPS-eredmény és visszaigazolás után állítható.

Ebben a körben nincs publikálás, narráció, render, próba/sorozat vagy receptregisztráció. Sandboxban sem videó, sem állókép nem készült. VPS-telepítés, tényleges digest, teljes önellenőrzés és friss életjel külön igazolandó. Meglévő videókhoz, archívumokhoz, nyugtákhoz és gépi titokhoz ez az előkészítés nem nyúl.