# Kylo önálló VPS-videógyár — előkészített, nem aktivált csomag

## Állapot

Elkészült: szigorú adat-recept/művelet szerződés, tartós SQLite feladatnyilvántartás, idempotencia, egyvideós foglalás/életjel, jóváhagyáshoz kötött sorozat, ötös adagnyugták, visszaellenőrzött helyi archívumtárolás, VPS-es teljes dekódolási ellenőrzés, kifelé kapcsolódó aláírt kliens, csak előkészítő telepítő és célzott szabálytesztek.

**Nincs telepítve/aktiválva, nincs valódi renderrel ellenőrizve.** A példa recept nem a szakmai vagy IELTS gyártó. Az eredeti recept és médiája nem található ebben a csomagban: változatlan, checksumos exportját a jóváhagyott eredeti csomagból kell átvenni.

**Blokkolók:** KyLogic feladatsor és tulajdonosi jogosultságellenőrzés; külön gépi titok; jóváhagyott, nem-root renderer image és jelenetlistája; valódi IELTS 27 nyelvi recept; ellenőrzött médiatranszfer; host tárhely/mount felmérés; régi gyártóval közös produkciós zárolás; új tárolók hozzáférései; Telegram gyári értesítési bekötés. S3/SFTP jelenleg kifejezetten „egyszeri bővítés szükséges”, nem működőnek álcázott tároló.

## Telepítés csak a valódi VPS-en

A csomag SHA256SUMS állományát függetlenül ellenőrizni/jóváhagyni kell. A telepítő nem indulhat letöltési nyugta alapján automatikusan. Az install.sh a saját ellenőrzött kezelő telepítője, nem a korábbi szakmai csomag tiltott install.sh-ja.

1. A tiszta csomagot külön hitelesített csomagátvitellel juttasd a hostra; az MP4-fogadó nem használható erre.
2. Hoston, jóváhagyott rendszergazdai lépéssel: `sudo bash install.sh`. Új release könyvtárba másol, inventory.json készül. **Nem aktivál, nem indít és nem állít le semmit.**
3. A felmérés alapján állítsd be a tartalékot, CPU/memóriát és igazold a csatolásokat. A példában 20 GiB/80% és 2 CPU/4 GB csak előzetes, óvatos korlát, nem teljes host-felmérés eredménye.
4. KyLogic védett végpontjai és külön titok: `/etc/kylo-video-factory/machine-secret`, 0600, minimum 32 karakter. A Brain worker/KyLogic közös titkát nem használjuk újra.
5. A gyártóképet külön átvizsgálás és próbafuttatás után rögzítsd digesttel; `renderers` csak helyi, jóváhagyott konfiguráció. Szerződés: csak olvasható `/request.json` és `/recipe`, írható `/work/output.mp4`; 65532:65532 felhasználó, hálózat nélkül. A kimenetet a kezelő symlink követése nélkül, saját mappába másolva ellenőrzi.

**Tulajdonosi jóváhagyás blokkoló:** a VPS a recept/próbavideó kötését ellenőrzi, a webes tulajdonost nem tudja önállóan hitelesíteni. Éles sorozathoz igazolt KyLogic-oldali tulajdonosi ellenőrzés szükséges.
6. Igazoltan lezárt/szünetelt régi gyártó; minden gyártó közös `/run/lock/kylo-video-production.lock` zárolást használjon. A régi recipe átadását és archívumát checksumokkal igazolni kell. `takeover_approved` addig false.
7. Az aktiválási symlink és a systemd egység telepítése külön jóváhagyott hostművelet; előbb az elkülönített próbavideó és a kapcsolódás vizsgálata szükséges. A mellékelt installer szándékosan nem végzi el.

## Üzemeltetés és visszaállítás

- Állapot `/var/lib/kylo-video-factory/work/state.sqlite3`, WAL/FULL szinkronizálással. Receptek és kész nyugták megmaradnak.
- Hálózati hiba nem töröl feladatot: a helyi elfogadott munka folytatható; az eredmény outbox nyugtáig marad. Brain-címet a kliens nem használ.
- Biztonságos pause az aktuális videó után; az újraindult kezelő lejárt foglalást visszavesz. Ugyanaz a videó a katalógus nyugtája alapján visszaellenőrződik, nem renderelődik újra.
- Alapból három ellenőrzött próbálkozás összesen; automatikus végtelen retry nincs. Kevés hely/bővítésigény blokkolt állapotot ad.
- Visszaállításkor a kezelő biztonságos leállása után korábbi ellenőrzött release aktiválható, állapot és archívum törlése nélkül. Aktív konténer esetén nem kezdhető új gyártó; a fix renderkonténer neve is megakadályozza az egyidejű új indítást.
- A régi Brain/YouTube-publikálás változatlan: az új `versioned-factory` kulcsok publikálási olvasási bekötése külön feladat, éles költözés nem történt.

## Értesítés

A tartós outbox `final_error` eseményt azonnali Kylo Admin-értesítéshez adja át a KyLogicnak. A reggel 8-as Budapest időzóna szerinti összefoglaló és beragadt munkák figyelése KyLogic-oldali feladat; nincs késznek állítva. Nincs videónkénti siker/retry Telegram-üzenet, közösségi publikálás vagy fizetős hanggenerálás.

## Elfogadási próbák

A hét valódi próba **mind nyitott**: VPS-render és visszaolvasás; Brain nélkül teljes flow; duplikált kézbesítés és host-újraindítás; jogosulatlan csomag/kevés hely; változatlan szakmai recept; új adat-recept és jóváhagyási korlát; alternatív tároló elkülönített tesztvideóval. A Python-szabálytesztek ezeket nem helyettesítik.