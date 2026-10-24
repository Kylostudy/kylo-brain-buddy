# KyLogic → önálló VPS-videógyár: v1 kapcsolódási szerződés

**Ez specifikáció és elkészült VPS-kliens, nem telepített KyLogic API.** A KyLogic projektben külön megvalósítandó. Brain alkalmazás nem része ennek a kapcsolatnak.

## Gépi kapcsolat

Csak a VPS kezdeményez HTTPS-t a konfigurált KyLogic origin felé. A konfigurált origin tartalmazhat alapútvonalat is (jelenleg `https://yqhipzwmgpopelfcenie.supabase.co/functions/v1/video-factory`); a kérés az `origin + "/" + operation` címre megy. Az aláírt üzenetben a path továbbra is a fix logikai prefix: `/api/public/video-factory/v1/<operation>` — a KyLogic ezt ellenőrzi, függetlenül a tényleges URL-útvonaltól. POST végpontok:

- `/claim`: `{schema_version:1, capabilities:["data-recipes-v1"],batch_size:5,concurrency:1}` → `{schema_version:1,command:null|Command}`.
- `/events`: egy outbox Event → `{schema_version:1,acknowledged_event_id:UUID}`; csak tartós mentés után nyugtázható.
- `/heartbeat`: gépállapot → `{schema_version:1}`. A VPS-kliens támogatja, az időszakos host-életjel bekötése még szükséges.

Fejlécek: X-Factory-Agent, X-Factory-Timestamp (Unix másodperc), X-Factory-Nonce (friss UUID), X-Factory-Signature (hex HMAC-SHA256).

Aláírt UTF-8 üzenet: `timestamp.nonce.METHOD.path.sha256_hex(rawBody)`. Külön, visszavonható factory-only secret. KyLogic ellenőrzi a gép tenant-grantjét, 120 másodperces időablakot, állandó idejű aláírás-összevetést, tartós nonce-egyediséget és legfeljebb 1 MiB törzsméretet. Az aláírás nem helyettesíti a csomagtartalom és tulajdonosi jogosultság ellenőrzését.

Válasz szintén aláírt: a kérés nonce-ja, friss válasz timestamp, `RESPONSE` method, ugyanaz a path és a nyers választörzs SHA-256-ja. Átirányítás tiltott. Kliens maximum 1 MiB választ olvas, ellenőrzi az időt, nonce-t és aláírást. Titok, teljes URL és nyers hiba nem naplózható.

## Command

`{schema_version:1,delivery_id:UUID,operation,payload}`. A delivery UUID nem receptazonosító. Ismételt azonos kézbesítés azonos eredményt ad; azonos UUID eltérő tartalommal konfliktus.

- register_recipe: payload a contract.py szigorú manifestje, csak adat és relatív objektumkulcs; nincs URL/titok/shell/install/code.
- trial: `{recipe_id,version}`.
- start_series: `{recipe_id,version,approval:{approval_id:UUID,recipe_sha256,trial_receipt_sha256,approved_at:unix_seconds,owner_authorized:true}}`.
- status/pause/resume/retry: `{job_id:UUID}`.
- preview: `{video_id:"recipe-id/version/video-id"}`. Csak jogosultsághoz kötött referencia, nem nyilvános host-út vagy lejáratlan publikus URL.

**KyLogic kötelező tulajdonosi ellenőrzése:** a jóváhagyás csak hitelesített jogosult tulajdonos explicit döntéséből hozható létre, a konkrét recept és ellenőrzött próbavideó hashéhez kötve. A VPS ellenőrzi a kötést, de nem egy távoli `true` mezőből állapítja meg a webes felhasználó személyazonosságát; azt a KyLogic garantálja a védett sor létrehozásakor.

## Event

`{schema_version:1,event_id:UUID,kind,entity_id,result}`. Tartósan idempotens feldolgozás. command_result, batch_verified, final_error. Médiabájt nincs benne, csak kis nyugta/katalógusadat. batch_verified öt videónként vagy a sor végén, próbavideóra külön nyugta; final_error azonnal feladható a kapcsolat helyreállásakor.

## Külön csomag-/médiatranszfer — hiányzó bekötés

Regisztrálás csak manifestet vesz át, nem hajt végre automatikus telepítést. Az ellenőrzött médiát külön hitelesített, host-allowlistes, darab-/bájt-/hash-korlátos átvitellel kell a `recipes/<id>/<version>` változatlan könyvtárba juttatni. Maximum 40 MiB/fájl, 600 MiB/csomag, 512 KiB manifest. Hiányzó/sérült média megállítja a gyártást. Futtatható renderer új verziója független kódellenőrzést és host-jóváhagyást igényel, nem receptművelet.

## KyLogic-oldali munkák

1. Gépi azonosítók/grant/revocation és tartós visszajátszásvédelem.
2. Tulajdonosi jogosultságú parancsfeladás és próbavideó-jóváhagyás.
3. Claim-foglalás és újrakézbesítés nyugta/életjel hiányában; globális megbízásazonosító megőrzése.
4. Események tartós tárolása és idempotens nyugtázása, beragadt feladatok jelzése.
5. Külön hitelesített médiacsomag-transzfer és jogosult előnézeti stream; a jelenlegi MP4-archiváló nem csomagfogadó.
6. Eredménykatalógus és külön publikálási olvasás; automatikus posztolás nélkül.
7. Kylo Admin végleges hibajelzés és napi 08:00 Europe/Budapest összefoglaló; meglévő figyelmeztetéseket nem némít el.
8. Jóváhagyott szakmai recept változatlan exportja és valódi IELTS 27 nyelvi csomag.

Ezek és a VPS-en aktivált, átvizsgált renderer nélkül a teljes távoli videógyártási flow nem kész.