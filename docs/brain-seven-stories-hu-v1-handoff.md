# Brain → KyLogic: hét magyar történet — előkészített kiadás

Ellenőrzési időpont: 2026-11-22T15:02:48.845682+00:00.

## Rövid eredmény

A külön `seven-stories-hu-v1` készítő forrása, tényleges request/recipe/work adaptere, hét HU próbára korlátozott ellenőrzője, pontos adatszerződése, biztonságos telepítési és visszajelzési útja elkészült. **Nem állítjuk, hogy már települt, vagy hogy kész videó van.** Narráció, videógyártás, receptregisztráció, sorozat és közösségi publikálás ebből a munkából nem indult.

- 314 videógyári teszt sikeres, köztük 26 új szabályteszt; 15 meglévő szerverjelentési/regressziós teszt sikeres.
- 170 ténylegesen megjelenített képkockaminta mind a hét történetből, átmenetekből, feliratkezdetekből, CTA-ból és outróból: nincs mért szöveg-/képelem-átfedés vagy kilógás, nincs böngészőhiba. Ez **nem teljes VPS-render QA**; a valódi készítő minden végleges képkockán ellenőriz, hiányzó bizonyíték esetén megáll.
- Mind a 21 eredeti adatfájl ellenőrzőösszege egyezik; mind a hét teljes MP3 dekódolható, az igazítás/felirat/jelenetidő és legalább 2 mp zárótartás rendben.
- A tényleges regisztrált könyvtárszerkezetet is kipróbáltuk helyi adatmásolatokon: `input_ok:true`, hét téma, összes bemeneti hiba együtt. `ok:false` helyesen megmarad a még hiányzó szerveres/gyártási ellenőrzések miatt.
- Csak hangot érintő, videó nélküli AAC-illesztési próbán mind a hét eredeti MP3 dekódolt hullámformája a változatlan időkezdéssel egyezik: hasonlóság 0.999967–0.999986; nincs gyorsítás vagy beszédlevágás. Az MP3-ak eredeti bájtjai változatlanok. A végleges MP4 hangját újra ellenőrizni kell.

## Készítő, jelenetek, médiaazonosság

Szerződés: `kylo-seven-stories-hu-v1`. Verzió: `v1`, kizárólag `hu`; 1080×1920, 30 fps.

**Tényleges új Docker-képdigest: MÉG NINCS IGAZOLVA.** A sandboxban nincs Docker/VPS-hozzáférés; nem adunk kitalált képdigestet.

A checksum-jegyzék forrásazonosítója `sha256:023a009fa58344bb67f696de9d16290785b92c64ae2276ee2ffb21ad660ac05f`. Ez **forráslenyomat, nem Docker-képdigest**. A telepítő a VPS-en elérhető, egyező konfigurációjú reviewed v4/v3 fontképből épít külön képet; a tényleges új kép és alap teljes digestjét a védett `seven_stories_renderer_status` visszajelzésben adja át. Régi készítőbejegyzést nem cserél.

| Téma | Jelenet | Jóváhagyott MP3 SHA-256 | Képi idővonal ms |
| --- | --- | --- | --- |
| auto | seven-stories-auto-hu-v1 | 9015f146cab137de945eca181aa2ccd9add04b31ad4663c5d6a13684e2d0aabb | 26600 |
| hajo | seven-stories-hajo-hu-v1 | cbde327044abe5507668405ac15910b95c3cce6d66eb873003d9a9a352a6b2dd | 23200 |
| hatizsak | seven-stories-hatizsak-hu-v1 | c91f0a28c9bdf16c7980be3220ae2f27c447de63843d83cd58e6034346b74c14 | 22167 |
| malacpersely-uj | seven-stories-malacpersely-uj-hu-v1 | da581568c39440469511cf0c5d74acb84278665819deb9c1c68de7bc2be397c9 | 24900 |
| repulo | seven-stories-repulo-hu-v1 | 5561656d51b0d18032614a3c28b69cc3b61b55403487b0cbdd8867a2b67589af | 25367 |
| szamlatorony | seven-stories-szamlatorony-hu-v1 | e01402b2111ee86eb063d7c1a0e819f27d6f3b30e2ef8e073ba3215170cdf3d0 | 25367 |
| ust | seven-stories-ust-hu-v1 | 5d24dc56e111022aab73e78c50fb47e542cb362925b3a9a22fd87e0b989a240e | 26200 |

## Pontos séma és adapter

A mellékelt `kylo-het-tortenet-hu-v1-szerzodes.json` tartalmazza mind a hét teljes, elfogadott receptet és a hét konstans receptből álló JSON Schema-t. A Python-ellenőrző minden mezőt és adattípust összevet a rögzített értékekkel; plusz/hiányzó mező, üres/eltérő hash, más történet, nyelv vagy változat elutasított.

Gyári boríték: `schema_version, recipe_id, version, renderer, series, languages, files, videos`. Témánként `recipe_id=seven-stories-<téma>-hu-trial`, `version=v1`, `series=other`, `languages=[hu]`, pontosan egy videó. A teljes videó és timeline a mellékletben szerepel; ezeket nem kézzel rekonstruálni kell.

Az eredeti csomag `inputs/<téma>/` három fájljának bájtjai az alábbi adatkulcsokra kerülnek:

| Eredeti név | Adatkulcs |
| --- | --- |
| narration.mp3 | audio/narration-mp3 |
| alignment.json | timing/alignment-json |
| timeline.json | timing/timeline-json |

A JSON-adatfájlokat sem szabad újraformázni, mert hash-kötöttek. A készítő csak a saját, helyileg átvizsgált forrását futtatja. A logó helyi, a korábbi ellenőrzött kutyalogóval bájtra egyezik. A forráscsomagot **nem** az adatfogadó/subject-package csatornára küldjük.

Konténerbemenet: `/request.json` = `{manifest, video}`; `/recipe` csak olvasható adat; `/work/output.mp4` kimenet. Megmarad a hálózattilalom, nem root futtatás, csak olvasható gyökér, erőforráskorlát és soros gyártási zár. Nincs távoli program vagy új fizetős szolgáltatás.

## Képi és hangszabályok

A járművek külön egymásból fejlődő formák, nem versenyzők: csónak → gőzös → utasszállító → Kylo-hajó; korai T-forma → családi → korszerű → Kylo-autó; korai kétszárnyú → légcsavaros → sugárhajtású → négymotoros, kétszintes utasszállítóforma. Más gyártó logója nincs.

Az üst/számlatorony/hátizsák külön eszközeiből kapcsolt rendszer/rendezett rekeszek lesznek; az új malacpersely ép marad, nem a régi videó újragyártása. Konkrét ár vagy a régi 105/29,99 USD ajánlat nem került bele.

A `sceneFrames` az egyetlen képi időforrás. A teljes hang 0-ról indul, eredeti tempóval; nincs atempo/asetrate/rubberband/playbackRate, beszédvágás, -shortest vagy feszesítő vágás. Az egész idővonal védett. A kimeneti hanghoz kizárólag a képi idővonal végéig szükséges csend adható.

Magyar felirat a rögzített karakterigazítás és jóváhagyott felirat alapján, doboz nélkül; Kylo-márkanév egységesítve a megjelenítésben, az eredeti adatfájl változtatása nélkül. Zóna: x=65–950, y=231–1459. CTA: „Próbáld ki ingyen 14 napig!” részletgazdag, megemelt arany kutyával; fekete outro normál kutyával, kylo.study, „A te AI magántanárod”. Az outro beszéde a fekete kép alatt marad, utána legalább 2 mp tartás.

## Közös ellenőrzés és telepítési út

A normál Brain-frissítés külön háttérmunkája **sorrendben** készíti elő az új képet, majd kizárólag siker után futtatja a meglévő, zárakkal védett kezelőaktiválást. A készítő-előkészítő önmagában nem indul gyártási feladatsorért és nem regisztrál receptet. A háttérmunka nem hoz létre próbaparancsot.

Regisztráláskor az új készítőhöz tartozó helyi közös ellenőrző mind a hét témát ellenőrzi a valódi regisztrált tárolóban; a hiányzó témákat ugyanabban az eredményben sorolja fel. Az eredmény a meglévő aláírt `self_check` eseményen és a védett `seven_stories_preflight` életjelmezőn érkezik. Az ACK tényleges visszaigazolását külön kell ellenőrizni.

Egyszeri kézi, csak ellenőrző parancs a hét regisztrált adatcsomagra, ha szükséges:

```sh
sudo python3 /opt/kylo-video-factory/current/seven_preflight.py \
  /var/lib/kylo-video-factory/recipes --registered \
  --config /etc/kylo-video-factory/config.json
```

A `preparation_ok` a valóban elérhető új képet, egyező reviewed/config bejegyzést, tárhelyet, mind a hét bemenetet és a teljes régi self-checket igényli. Az `ok` nem lesz igaz, amíg gyártási QA/visszaolvasás/ACK kihagyott. Ezeket **nem** nevezzük sikeres vizsgálatnak.

## Friss szerveréletjel és fennmaradó akadályok

A védett adatokból ténylegesen lekért életjel: **2026-11-22 14:54:31.977032 UTC**, a megfigyelés **14:54:31.747161 UTC**; a meglévő videógyár aktív. A 14:49:07 UTC általános életjel 0 futó munkát és 34,8% lemezhasználatot mutatott. Ez nem bizonyítja az új készítő telepítését.

Az életjelben visszaküldött legutóbbi teljes self-check **2026-11-21 12:44:32 UTC**-s, tehát **régi**, `ok:false`, KyLogic átvette. Négy régi készítő képhivatkozását nem találta: IELTS-fonts, exam-v1, safe-v2, safe-v3. V4, három malacpersely és vizsgaszimulátor a régi riportban elérhető. Ez nem bizonyít mostani képtörlést, és ebben a feladatban nem módosítottuk ezeket. Új teljes self-check szükséges; igazolt régi hibát külön, célzottan lehet vizsgálni, nem kikapcsolással.

Fennmaradó akadályok:
1. Az új forrás még nem került igazoltan a VPS-re; egyszeri Brain-publikálás/frissítés és a háttértelepítés befejezése szükséges. A tényleges új kép/alap teljes digestje csak utána adható.
2. Friss teljes self-check, régi renderelők/fontok és az eredeti archívum/nyugták szerveres megőrzésének bizonyítéka szükséges. A helyi forrás-egyezés ezt nem helyettesíti.
3. KyLogic hét adatcsomagjának regisztrált visszaolvasása, közös előellenőrzés és ACK még nem történt meg.
4. A valódi, minden képkockás VPS-QA és végleges MP4-hang/archívum-visszaolvasás csak a későbbi engedélyezett próbákon történhet. Kész MP4 most nincs.

A régi ellenőrzők, v3 overlayek és az eredeti régi renderelőkönyvtárak a munka előtti Git-változathoz képest változatlanok; a 314 teszt ezt regressziókkal is ellenőrzi. A gépi titokhoz, VPS-archívumhoz, nyugtákhoz és eredeti videókhoz nem nyúltunk.

## Következő lépés és felelős

**Sándor:** egyszer publikálja a Brain-frissítést; azért szükséges, hogy az új készítő és közös ellenőrző a VPS-re jusson. Ez nem videóindítás.

**Brain:** utána a már bekötött védett életjelből ellenőrzi az új kép/alap teljes digestjét, a telepítést és friss teljes self-checket; hiányzó vagy hibás bizonyíték esetén nem jelez gyártásra kész állapotot.

**KyLogic:** csak igazolt telepítés után regisztrálja a mellékelt hét változatlan adatcsomagot, megvárja a közös ellenőrzést/ACK-t; csak minden előfeltétel sikerénél indít pontosan hét külön HU próbát, hajóval kezdve, sorosan. Nincs start_series, más nyelv, duplikált gyártás vagy közösségi publikálás. A régi self-check hibái addig akadályok, amíg friss eredmény nem tisztázza őket.
