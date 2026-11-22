# Brain → Sándor / KyLogic: hét történet — igazolt hanghosszhiba javítása

## Az ok igazolása

Sándor 2026-11-22 **16:02:09 UTC**-s szerveres ellenőrzése mind a hét témánál `seven_audio_duration` hibát mutatott. Az MP3-ba kódolt technikai késleltetés és végkitöltés beleszámított a szerver által jelentett fájlhosszba, míg a jóváhagyott idő a tényleges dekódolt hang hossza.

A szerverről kapott összes hossz pontosan megegyezik az eredeti MP3 csomagjainak `csomagszám × 1152 / 44100` időtartamával. A teljes eredeti hang dekódolt mintaszáma viszont mind a hét témánál egyezik a jóváhagyott idővel. Nem a narráció vagy a recept hibás; a mérési mód volt eltérő.

| Téma | VPS fájlhossz (s) | Tényleges hang (s) | Dekódolt minták | Zárótartás (s) |
| --- | ---: | ---: | ---: | ---: |
| auto | 24.607347 | 24.566712 | 1083392 | 2.033288 |
| hajo | 21.211429 | 21.176599 | 933888 | 2.023401 |
| hatizsak | 20.192653 | 20.154921 | 888832 | 2.012079 |
| malacpersely-uj | 22.935510 | 22.894875 | 1009664 | 2.005125 |
| repulo | 23.405714 | 23.359274 | 1030144 | 2.007726 |
| szamlatorony | 23.405714 | 23.359274 | 1030144 | 2.007726 |
| ust | 24.241633 | 24.195193 | 1067008 | 2.004807 |

## Elkészült javítás

- A `seven_audio.py` a teljes hangot dekódolja az eredeti mintavétellel és csatornaszámmal, majd a mintaszámból számol hosszt. Nem vág, nem gyorsít, nem alakítja át a mintavételt és nem ír médiafájlt.
- A közös előellenőrző és a készítő ugyanazt a mérési kódot használja. Az engedélyezett eltérés továbbra is **2 ms**, a beszéd utáni tartás továbbra is **legalább 2 s**.
- A készítőben is megtaláltuk az azonos hibás fájlhossz-ellenőrzést. Ezért a javítás egy checksumhoz kötött, csak olvasható `index.ts` és közös mérőmodul csatolása, kizárólag a hét pontos magyar v1 próbához és a meglévő, ellenőrzött képhez.
- A kép változatlan: `sha256:2fad84eb73bfd8938228f09bb52139001e667c445d80a8a93aab19d035acfddb`. Nem épül új kép és nem változik a regisztrált recept.
- Mindkét telepítőlistába bekerült minden új függőség; a teljes telepítési checksum-jegyzék frissült.
- A külön diagnosztikai parancs a hét regisztrált bemenetet, a javítófájlokat, a képet, tárhelyet és az összes korábbi készítőt ellenőrzi; kizárólag a saját aláírt `self_check` eseményét küldi el. Nem kér feladatot, nem regisztrál receptet, nem indít vagy ismétel próbát.

## Ellenőrzött eredmények

**334 videógyári teszt sikeres.** A valódi 21 eredeti adatfájllal mind a hét bemenet átmegy mindkét könyvtárszerkezetben, a VPS által jelentett régi fájlhosszértékek mellett is: 14 teljes bemeneti ellenőrzés. A hangok teljesen dekódolódtak; minden igazítás, felirat, jelenetidő és zárótartás sikeres.

A valóban rövidebb hang, 2 s-nál rövidebb tartás, üres dekódolás, több hangsáv, megváltoztatott/hiányzó/írható javítófájl és más képdigest továbbra is elutasított. A külön diagnosztikai esemény és valódi ACK-követelmény tesztje is sikeres; recept és gyártási feladat nem jött létre.

**Ez helyi igazolás, nem új VPS-es sikerjelentés.** Nem indult videógyártás, narráció, sorozat vagy közösségi publikálás. Az eredeti bemenetek, receptek, archívumok, nyugták, régi képek és készítők változatlanok.

## Egy további szerveres akadály

A feltöltött ellenőrzés a bemeneti hibákon kívül a korábbi `seven_preflight.py` 116. sorában is `ValueError`-t jelzett. Ez a teljes régi önellenőrzés sikertelenségének helye. A részletes régi eredmény nincs a beküldött kivonatban, ezért ennek aktuális okát még nem állítjuk biztosnak és nem változtatunk más készítőn találgatás alapján.

Az új jelentés a szerveres hibáknál is megadja a pontos lépést és a rögzített okot; a teljes korábbi önellenőrzés eredményét is tartalmazza. Ha ez még hibás, a `preparation_ok` helyesen hamis marad és próba nem indulhat.

## Következő lépés — Sándor

1. **Egyszer publikáld a Brain-frissítést.** Ez szükséges ahhoz, hogy a javított mérő és a két védett javítófájl települjön a VPS-re. A frissítés nem hoz létre próbaparancsot.
2. A telepítés befejezése után futtasd SSH-n:

```sh
sudo python3 /opt/kylo-video-factory/current/self-check-only.py --seven-stories
```

3. Küldd vissza a teljes kimenetet. Ha a fájl még hiányzik, a telepítés még nem igazolt; ne regisztrálj vagy indíts újra semmit.

## Következő lépés — Brain

Brain ellenőrzi a friss UTC-időpontot, mind a hét témánál az eredeti mintaszámot és a sikeres bemeneti vizsgálatokat, `input_ok:true`, `preparation_ok:true`, a változatlan teljes képdigestet, a két checksumhoz kötött javítófájlt, a teljes régi önellenőrzést és **`kylogic_acknowledged:true`** értéket. Ezek most még nem igazoltak a frissített VPS-en.

A felső `ok:false` önmagában várható, mert a még el nem készült videók képkockás ellenőrzése, hang-visszaolvasása és archívum-ellenőrzése nem lehet késznek jelölve. Ez nem helyettesíti a kötelező `preparation_ok:true` és tényleges átvétel ellenőrzését.

## Következő lépés — KyLogic

A hét receptet ne regisztrálja újra, hangot és időzítést ne módosítson. Csak az új sikeres bemeneti/szerveres előellenőrzés és átvétel után indulhat hét külön magyar próba, egyenként: **hajó → autó → repülő → üst → számlatorony → hátizsák → új malacpersely**. Sikertelen próbánál megállás és hibajelentés; nincs automatikus ismétlés, sorozat, más nyelv, új narráció vagy publikálás.