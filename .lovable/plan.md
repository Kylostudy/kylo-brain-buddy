# Meggyőzés Klub archiváló + leirat workflow

## Mit kap a felhasználó
Egy új workflow a Brainben: „Meggyőzés Klub archívum”. Elindítva:
1. Belép a klub.meggyozes.hu oldalra a saját fiókjával (e-mail + jelszó, a Brain fióktárában tárolva).
2. Végigjárja az összes leckét/menüpontot, és listát készít minden anyagról.
3. Letölti a VPS-re: a szövegeket, az MP3-akat és a videókat (ha letölthetők). Csak a szerverre kerülnek, a felhőbe nem.
4. A VPS-en helyben, magyar nyelvű beszédfelismerővel leiratot készít minden MP3-ból és videóból.
5. A leiratokat Kylomind-barát formára rendezi: leckénként egy dokumentum, fejezetcímekkel, alcímekkel, bekezdésekkel, a forrás (lecke neve, dátum, eredeti link) feltüntetésével.
6. A Brain felületén látszik a haladás: hány anyagot talált, mennyi van letöltve, mennyi leirat kész, és mi bukott el.

A rendszer óvatosan halad (szünetekkel, egyszerre egy letöltés), és újraindítva a már kész anyagokat átugorja.

## Lépések
1. **Felderítés (első futás):** belépés, és csak a lecketérkép elkészítése, letöltés nélkül. Ebből derül ki, milyen az oldal felépítése (beágyazott lejátszó, Vimeo/YouTube, közvetlen fájl).
2. **Letöltés:** szöveg → tiszta szövegként mentve; MP3 → közvetlenül; videó → közvetlenül vagy yt-dlp-vel (beágyazott lejátszónál is).
3. **Leirat:** a VPS-en már meglévő faster-whisper felismerővel, magyar nyelvre állítva, a nagyobb pontosságú modellel.
4. **Tagolás:** a nyers leiratot a Brain AI-ja fejezetekre bontja, címeket ad, és kijavítja az írásjeleket. Tartalmat nem talál ki és nem rövidít.
5. **Kimenet Kylominhoz:** egy mappa a VPS-en (`/opt/brain/meggyozes-klub/`), benne leckénként Markdown fájl, plusz egy tartalomjegyzék. A Kylomindba töltés a következő körben jön, amikor megvan, hogyan fogadja a Kylomind az anyagot.

## Nyitott kérdés a felhasználó felé
- A belépési adatokat a Brain fióktárában kell megadni (biztonságos űrlap).
- Ha az oldal letiltja a letöltést vagy nem enged közvetlen fájlt, a videóknál csak a hang töltődik le a leirathoz.

## Technikai részletek
- Új brain-task típusok: `membership_crawl`, `membership_fetch`, `membership_transcribe`, a meglévő `stt_media_fetch`/`stt_calibrate` mintájára (`worker/executor/scripts/brain-tasks/`), regisztrálva az `index.js`-ben, adatbázis típuskorlátozás bővítése migrációval.
- Tárolás: új host-mount `/opt/brain/meggyozes-klub` → `/membership` a `worker/docker-compose.yml`-ben (blue/green mindkét oldalán ugyanaz a volume).
- Hitelesítés: tartós böngészőprofil saját workflow-fiókhoz kötve (AGENTS.md szerinti elkülönítés), magyar lakossági IP, valós Linux identitás.
- Állapot: `membership_items` tábla (url, típus, státusz, méret, leirat-hossz, hiba) — egyedi kulcs URL-re, idempotens újrafuttatás; korlátos köteg futásonként, egyfutásos zár.
- Tagolás: Lovable AI Gateway hívás a szerveroldalon, szövegenként; 402/403/429 esetén a feladat szünetel.
- A felhőbe csak kis státuszadat kerül; hang/videó/leirat a VPS-en marad.
