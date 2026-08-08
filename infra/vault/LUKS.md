# Kylo Vault — LUKS titkosítás (1. lépés, a Syncthing ELŐTT)

Ez teszi olvashatatlanná a fájlokat magán a lemezen. Ha valaki fizikailag
hozzáfér a vashoz (adatközponti technikus, lefoglalás, kidobott merevlemez),
kulcs nélkül nem lát semmit.

**Fontos sorrend:** először a titkosított kötet, csak utána indul a Syncthing —
különben a fájlok először titkosítatlanul kerülnének a lemezre.

---

## Ennél a szervernél: a két lemez már tükrözve van

A `lsblk -f` alapján a két NVMe **RAID1-ben** fut (`md0`, `md1`, `md2`), vagyis
minden írás azonnal, valós időben rákerül **mindkét fizikai lemezre**. Ez jobb,
mint az óránkénti tükrözés lett volna: ha az egyik lemez meghal, a másik viszi
tovább, veszteség nélkül.

Ebből két dolog következik:

1. Külön „2. winchesterre tükrözés" **nem kell** — a RAID már megcsinálja.
2. Nincs szabad, üres partíció, ezért a titkosítást **fájl-alapú LUKS kötettel**
   csináljuk (`luks-file-setup.sh`). Ugyanaz a védelem, csak partíció helyett
   egy nagy fájl a tároló.

> A RAID a lemezhalál ellen véd, a **véletlen törlés** ellen nem. Azt a Syncthing
> 30 napos verziótörténete + a napi pillanatképek adják (lásd lentebb, 5. lépés).

---

## 1. lépés — a titkosított széf létrehozása

```bash
cd ~/kylo-worker && git pull
cd infra/vault && chmod +x luks-file-setup.sh
sudo VAULT_SIZE=100G ./luks-file-setup.sh
```

A méretet szabadon állítsd (jelenleg 397 GB szabad hely van, tehát a 100G
kényelmes indulás; később bővíthető).

A script:
- rákérdez, tényleg akarod-e (`IGEN`),
- készít egy kulcsfájlt, hogy újraindítás után magától felnyíljon,
- kér egy **tartalék jelszót** — ezt azonnal mentsd a Bitwardenbe,
- formázza, csatolja `/srv/kylo-vault` alá, és létrehozza a `config` + `data` mappát.

## 2. lépés — ellenőrzés újraindítással

```bash
sudo reboot
# újra belépve:
df -h /srv/kylo-vault
```

Ha a reboot után is ott van csatolva, a titkosítás jól működik.

## 3. lépés — jöhet a Syncthing

```bash
cd ~/kylo-worker/infra/vault && docker compose up -d
docker logs kylo-vault --tail 20
```

Innentől a `README.md` 2. lépésétől folytasd (felület SSH-alagúton, géped összekötése).

## 4. lépés — tűzfal a közvetlen (relay nélküli) kapcsolathoz

```bash
sudo ufw allow 22000/tcp comment 'syncthing'
sudo ufw allow 22000/udp comment 'syncthing'
```

## 5. lépés — véletlen törlés elleni védelem

- A Syncthing mappánál (VPS oldal): `Receive Only` + `Staggered versioning`, 30 nap.
- Napi pillanatképek ugyanezen a köteten (helytakarékos hardlinkkel):

```bash
sudo install -m 755 mirror.sh /usr/local/bin/kylo-vault-mirror.sh
sudo cp kylo-vault-mirror.service kylo-vault-mirror.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kylo-vault-mirror.timer
```

A `kylo-vault-mirror.service` ennél a szervernél már úgy van beállítva, hogy
ugyanazon a RAID-köteten készítsen pillanatképeket (`VAULT_ALLOW_SAME_DISK=1`),
mert külön lemez nincs.

---

## Mit tegyél, ha elveszik a kulcsfájl

A `/root/.kylo-vault-keys/` mappa a szerveren van. Ha a szerver újratelepül,
a **tartalék jelszóval** tudod megnyitni a kötetet:

```bash
sudo cryptsetup open /var/lib/kylo-vault.img kylo-vault-data
sudo mount /dev/mapper/kylo-vault-data /srv/kylo-vault
```

Ezért kritikus, hogy a tartalék jelszó a Bitwardenben legyen. Kulcsfájl +
jelszó együttes elvesztése = az adat visszahozhatatlan.

## Mi ellen véd és mi ellen nem

| Kockázat | Véd? |
|---|---|
| Valaki elviszi / kiolvassa a lemezt | ✅ igen |
| Leselejtezett, kidobott lemez | ✅ igen |
| Adatközponti technikus kíváncsiskodik | ✅ igen |
| Az egyik lemez meghal | ✅ igen (RAID1) |
| Véletlen törlés | ✅ verziótörténet + pillanatképek |
| Feltörik a futó szervert (SSH, root) | ❌ nem (futás közben nyitva van) |
| A saját géped fertőzött | ❌ nem |

Ezért marad fontos: erős SSH-kulcs, jelszavas belépés tiltva, Fail2ban, tűzfal.

---

## Partíciós változat (más szerverhez)

Ha egy későbbi VPS-en lesz valódi üres lemez, ott a `luks-setup.sh` a jó:

```bash
sudo VAULT_DEV=/dev/sdb1 VAULT_NAME=kylo-vault-data VAULT_MOUNT=/srv/kylo-vault ./luks-setup.sh
```
