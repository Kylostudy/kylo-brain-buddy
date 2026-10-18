# KyLogic → Brain: subject factory csomagfogadás v1

## Aktuális állapot

A tényleges 17 fájlos csomag átadása megtörtént: `subject-package-15c8067f160ac6210eeab821`, manifest `15c8067f160ac6210eeab8211674e233f4333b6939e5e870957eae38d6c6b769`, összesen 494 419 260 bájt. Az éles kapu elfogadta, a VPS a fogadót futtatta és az azonossági fájlt megírta, de 12:13 UTC-kor az első README kapcsolatfelépítése elbukott. A Node `all:true` DNS callback egyetlen cím helyett címlistát vár; a régi kóddal reprodukált hiba `ERR_INVALID_IP_ADDRESS`. A javítás mindkét callback formát támogatja, megőrzi a DNS-címhez kötést; 10 teszt és a valódi, titkos link nélküli HTTPS-kapcsolat sikeres. Frissítési kérés: `caaf3851-8b81-4357-8b1c-5dede443da4a`. A gyártó nincs telepítve, első VPS-es adag nem bizonyított.

2026-10-18 UTC ellenőrzés: 9 helyi csomagvédelmi teszt sikeres; az alkalmazás valódi HTTP kérésekkel 401-et adott aláírás nélkül, 403-at más tenantnak, 400-at hibás manifestre. Egy szerverfrissítés 11:54:30 UTC-kor sikerült (blue aktív), de ezt nem tekintjük az utána elkészült fogadó telepítési bizonyítékának. Az új fogadóhoz külön frissítési kérés készült: `18f3c22a-3fa0-4198-993c-f113e22feb23`; átvétele még nem bizonyított. Közvetlen VPS-es parancsvégrehajtási kapcsolat nincs igazolva; a meglévő, szűk frissítő és visszaküldött napló áll rendelkezésre. Root-telepítési végpontot nem nyitottunk.

2026-10-18 12:18 UTC: a kért frissítés succeeded, de a napló szerint ismét a régi `14f2444` verziót építette, nem a most javított fogadót. A meglévő feladat feltételes újrapróbálása megtörtént (attempt_count=1), a normál dispatcher új futást indított (`3153f650-e06f-4ccb-a2b4-8506b7ac628f`), amely azonos hibával leállt. Újabb átvételt csak a javított verzió tényleges átvételének bizonyítéka után szabad indítani. A teljes 17 fájlos átvétel, telepítés és öt új videó továbbra sem igazolt.

## Kérés

`POST https://brain.kylosystems.com/api/public/cross/kylogic/task`

Task: `receive_subject_factory_package`, verzió `1`.

HMAC v1: `${timestamp}.POST./api/public/cross/kylogic/task.${sha256(rawBody)}`, HMAC-SHA256 hex a meglévő Brain–KyLogic kulccsal. Fejlécek: `X-Kylo-Module: kylogic`, `X-Kylo-Timestamp`, `X-Kylo-Signature: t=<timestamp>,v1=<hex>`, `X-Tenant-ID: 14abbe6b-4781-4483-967f-84d87e0d2b05`, `Idempotency-Key` azonos a `task_id` értékével. ±300 másodperces időablak.

Az idempotenciakulcs 1–120 betű, szám, `_` vagy `-`. Egy task_id alatt csak azonos csomag/hash/fájlméret fogadható újra; eltérő azonosság 409. Új linkek önmagukban nem változtatják meg a csomag azonosságát; már sorban levő feladat URL-jeit az újraküldés nem cseréli ki. Lejárt linkes, sikertelen futáshoz új task_id kell, változatlan manifesttel.

Pontosan 17 fájl: `README.md`, `install.sh`, `SHA256SUMS`, `payload.part-000`–`payload.part-013`. A manifest hashét a hitelesített kérés tartalmazza. A SHA256SUMS pontosan a másik 16 fájlt sorolja fel, sha256 + két szóköz + fájlnév formában.

Engedélyezett forrás: kizárólag HTTPS `yqhipzwmgpopelfcenie.supabase.co`, `/storage/v1/object/` útvonal. Átirányítás tilos. DNS-ellenőrzés után a kapcsolat az ellenőrzött nyilvános IPv4-címhez kötött; helyi/privát/link-local és IPv6 címek nem használhatók. Maximum 40 MiB/fájl, 600 MiB/csomag, 180 másodperc/fájl, 30 perc + az utolsó megkezdett fájl maximum 180 másodperce/csomag. A méretkorlát Content-Length nélkül is érvényes.

A `docs/subject-factory-request.example.json` mind a 17 fájlt tartalmazza; helyettesítsd a jelölt méretet, hashértéket és példalinket a tényleges adatokkal. A példahash és példaméret nem valódi, így a példa nem elküldhető csomag.

Callback: `https://kylogic.lovable.app/api/public/…` az átadó tényleges callback-útvonalával. Ha a KyLogic más címet használ, előbb egyeztetni és célzottan engedélyezni kell; általános callback-host nem engedélyezett.

## Állapot és válasz

`GET /api/public/cross/kylogic/subject-factory-status?task_id=<id>` ugyanezzel a HMAC-val, a teljes útvonal+query aláírásával, üres body-val és kötelező X-Tenant-ID-val.

Elfogadás: HTTP 202 `{ok:true, task_id, version:1, package_id, manifest_sha256, status:"queued", idempotent_replay:false, installation_status:"not_installed"}`. Újraküldés HTTP 200. Hibák: 400 érvénytelen csomag, 401 hibás aláírás, 403 tiltott tenant, 409 ütköző idempotencia, 503 hiányzó fogadó-munkafolyamat, 500 tárolási hiba.

Állapot: `{ok,task_id,status,completed_at,receipt_status,installation_status,manifest_sha256,files:[{name,bytes,sha256}],error}`. Sikeres fogadásnál `status:"succeeded"`, `receipt_status:"verified"`, `installation_status:"awaiting_review"`. Ez NEM telepítési vagy gyártási siker. Hiba esetén `status:"failed"`, `error:"package_receipt_failed"`; a szűrt részletek a Brain futási naplójában. A callback is csak szűk, link nélküli fogadási eredményt küld.

Fizikai mappa: `/var/brain/factory-packages/subject-20261018-v1`. Atomikus hard-link véglegesítés, meglévő azonos méret/hash átvétele, eltérő fájl blokkol. Receipt/audit nem tartalmaz letöltőlinket; a sorban a letöltéshez szükséges URL-ek privát payloadként maradnak. Fogadás nem futtat install.sh-t és nem bont tar-t.

## Telepítési blokkolók

A KyLogic forráskódjának ellenőrzésekor az install.sh közvetlen tar-kibontást végez, és az inaktív korábbi forrásmappát felülírhatja. Nincs előzetes tar-bejegyzés/összméret/symlink/hardlink/eszközfájl vizsgálat, tárhely- és Brainen felüli erőforrástartalék-vizsgálat. Ezért ezt a telepítőt ellenőrzés nélkül NEM futtatjuk rootként.

A tényleges 17 fájl átvétele után szükséges: manifest és kibontási határok ellenőrzése; csomagverzió forrásainak vizsgálata; változatlan archívum és státusznyilvántartás; munka/staging/archív fájlrendszer azonosság; legalább 5 GiB szabad hely és külön build-tartalék; megfelelő erőforrások; célzott, ellenőrzött telepítés. Általános shell/exec kapu nem készül.

A javított VPS-verzió igazolása után a Brain a konkrét failed sort feltételesen queued állapotba állíthatja, változatlan payload/azonosság mellett, csak ha nincs hozzá aktív futás. A régi hibás futás és az archívum megmarad. Ez üzemeltetési újrapróbálás, nem az idempotens POST viselkedésének megváltoztatása. Lejárt link esetén új KyLogic task_id, változatlan manifest és 17 azonos fájl friss aláírt URL-je kell. Ezután lehet az ellenőrzött telepítést és valódi gyártást bizonyítani.