# Kylo Vault — a Tresorit kiváltása a saját VPS-eden

Ugyanaz az élmény, mint a Tresoritnál: van a gépeden egy mappa, amit a rendszer
magától szinkronban tart. Csak most a saját vasadon, havidíj nélkül.

## Hogyan épül fel

1. **Syncthing** (a gépeden ↔ a VPS-en) — titkosított csatornán, folyamatosan
   szinkronizál. A VPS a „mindig bekapcsolva” példány.
2. **Óránkénti tükrözés a 2. winchesterre** — ha az egyik lemez meghal, a másikon
   ott az adat. Ráadásul 7 napos visszamenet is készül (véletlen törlés esetére).
3. **Később: második helyszín** — ha lesz másik VPS más országban, a `geo-replica.sh`
   naponta átküldi oda is. Így 3 példányod lesz, két országban.

---

## 1. lépés — VPS: Syncthing elindítása

```bash
cd ~/kylo-worker && git pull
sudo mkdir -p /srv/kylo-vault/config /srv/kylo-vault/data
sudo chown -R 1000:1000 /srv/kylo-vault
cd infra/vault && docker compose up -d
docker logs kylo-vault --tail 20
```

## 2. lépés — a felület megnyitása (biztonságosan)

A felület csak a VPS-en belülről érhető el. A saját gépedről egy SSH-alagúttal nyisd meg:

```bash
ssh -L 8384:127.0.0.1:8384 <felhasznalo>@<vps-ip>
```

Utána a böngésződben: <http://127.0.0.1:8384>

Első belépéskor állíts be felhasználónevet + jelszót (Settings → GUI).

## 3. lépés — a saját géped összekötése

1. Telepítsd a Syncthinget a gépedre: <https://syncthing.net/downloads/>
2. A gépeden nyisd meg a Syncthing felületét, másold ki a **Device ID**-t.
3. A VPS felületén: **Add Remote Device** → beilleszted a gép azonosítóját.
4. A gépeden a Tresorit-mappa helyett add hozzá a kívánt mappát (**Add Folder**),
   és oszd meg a `kylo-vault` eszközzel.
5. A VPS oldalon fogadd el, és a mappa útvonalának add meg: `/var/syncthing/data/<mappa-neve>`

**Ajánlott beállítás a mappán (a VPS oldalon):**
- Folder Type: `Receive Only` — így a VPS soha nem ír vissza a gépedre.
- File Versioning: `Staggered`, 30 nap — ez a Tresorit „verziótörténet” funkciója.

## 4. lépés — tükrözés a második winchesterre

Először nézd meg, hova van csatolva a 2. lemez:

```bash
lsblk -f
df -h
```

Ha még nincs csatolva (példa, `/dev/sdb1` esetén):

```bash
sudo mkdir -p /mnt/disk2
sudo mount /dev/sdb1 /mnt/disk2
# tartós csatolás újraindítás után is:
echo "UUID=$(sudo blkid -s UUID -o value /dev/sdb1) /mnt/disk2 ext4 defaults 0 2" | sudo tee -a /etc/fstab
```

Majd a tükrözés bekapcsolása:

```bash
cd ~/kylo-worker/infra/vault
sudo install -m 755 mirror.sh /usr/local/bin/kylo-vault-mirror.sh
sudo cp kylo-vault-mirror.service kylo-vault-mirror.timer /etc/systemd/system/
# ha nem /mnt/disk2 a 2. lemez, ird at a .service fajlban a VAULT_MIRROR sort!
sudo systemctl daemon-reload
sudo systemctl enable --now kylo-vault-mirror.timer
sudo systemctl start kylo-vault-mirror.service
journalctl -u kylo-vault-mirror -n 30 --no-pager
```

Ellenőrzés bármikor: `systemctl list-timers kylo-vault-mirror.timer`

## 5. lépés (később) — második helyszín

Amikor lesz másik VPS:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/kylo-vault -N ""
ssh-copy-id -i ~/.ssh/kylo-vault.pub kylo@<masik-vps-ip>
sudo install -m 755 geo-replica.sh /usr/local/bin/kylo-vault-geo.sh
VAULT_REMOTE="kylo@<masik-vps-ip>:/srv/kylo-vault-replica" /usr/local/bin/kylo-vault-geo.sh
```

Utána ugyanígy tehető napi időzítésre egy systemd timerrel.

---

## Mire figyelj

- **A Tresorit-előfizetést csak akkor mondd le**, ha a Syncthing felületén a mappa
  már „Up to Date”, és a `/mnt/disk2/kylo-vault/current` mappában is látod a fájlokat.
- A `/srv/kylo-vault/config` mappa tartalmazza a széf kulcsait — ezt ne töröld.
- A két winchester **nem** RAID, tehát nem valós idejű: a tükrözés óránként fut.
  Ez a legrosszabb esetben 1 óra veszteséget jelent — a Syncthing miatt viszont a
  friss állapot mindig ott van a saját gépeden is.
- Titkosítás: az átvitel mindig titkosított (TLS 1.3, kölcsönös eszköz-hitelesítés).

---

## Titkosítás — pontosan hogyan áll

**Átvitel közben:** a Syncthing minden kapcsolata TLS 1.3-mal titkosított, és a két
oldal a saját eszközazonosítójával (kulcs ujjlenyomatával) igazolja magát. Idegen gép
akkor sem tud csatlakozni, ha kitalálja az IP-t: nincs benne a te eszközlistádban.
Tehát az adatkapcsolat **nem nyilvános**, senki nem tudja lehallgatni vagy leszedni.

**Extra szigorítás (ajánlott, 1 perc).** Alapból a Syncthing használhat nyilvános
„relay” szervereket, ha nem talál közvetlen utat. Az adat ott is titkosított (a relay
csak vak csomagokat továbbít), de ha a legszigorúbb módot akarod, kapcsold ki:

A felületen (SSH-alagúton át): **Settings → Connections** →
- `Enable Relaying`: **ki**
- `Global Discovery`: **ki**
- `NAT traversal`: maradhat

Majd a saját gépeden a `kylo-vault` eszköznél add meg fixen a címet:
`tcp://<vps-ip>:22000`. Ettől kezdve az adat kizárólag a te géped és a te VPS-ed
között, közvetlenül megy.

A VPS tűzfalán ehhez engedni kell a Syncthing portját:

```bash
sudo ufw allow 22000/tcp comment 'syncthing'
sudo ufw allow 22000/udp comment 'syncthing'
```

**A lemezen (nyugalmi állapotban):** jelenleg a fájlok olvashatóan pihennek a VPS
lemezén — mint a Tresoritnál a saját gépeden. Ha azt is titkosítanád, két út van:
titkosított kötet (LUKS) a lemez alá, vagy a Syncthing „untrusted device” módja,
amitől a VPS csak titkosított darabokat lát. Szólj, ha kéred, összerakom.

---

## Hány példány lesz belőle?

| Példány | Hol | Mikor frissül |
|---|---|---|
| 1. | a saját gépeden | azonnal |
| 2. | VPS 1. lemez (`/srv/kylo-vault/data`) | azonnal (Syncthing) |
| 3. | VPS 2. winchester (`/mnt/disk2/kylo-vault/current`) | óránként |
| 3b. | 7 napos pillanatképek a 2. lemezen | naponta |
| 4. | másik országbeli VPS | később, `geo-replica.sh` |

Tehát **igen: már most két külön fizikai lemezre ír a VPS-en belül**, plusz ott a
géped. Ez a mai naptól három példány. Amikor lesz másik VPS, a `geo-replica.sh`
napi másolattal viszi negyedik helyre — az már földrajzilag is szétosztott.

