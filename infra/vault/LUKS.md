# Kylo Vault — LUKS titkosítás (1. lépés, a Syncthing ELŐTT)

Ez teszi olvashatatlanná a fájlokat magán a lemezen. Ha valaki fizikailag
hozzáfér a vashoz (adatközponti technikus, lefoglalás, kidobott merevlemez),
kulcs nélkül nem lát semmit.

**Fontos sorrend:** először a titkosított lemez, csak utána indul a Syncthing —
különben a fájlok először titkosítatlanul kerülnének a lemezre.

---

## 0. lépés — nézzük meg, milyen lemezeid vannak

```bash
lsblk -f
df -h
```

Írd meg nekem a kimenetet, ha bizonytalan vagy, melyik a 2. winchester.
A rendszerlemezt (ahol a `/` van) **soha ne** add meg!

## 1. lépés — a Syncthing legyen leállítva

```bash
cd ~/kylo-worker/infra/vault && docker compose down || true
```

## 2. lépés — az 1. adatlemez titkosítása

Példa, ha a lemez `/dev/sdb1`:

```bash
cd ~/kylo-worker && git pull
cd infra/vault && chmod +x luks-setup.sh
sudo VAULT_DEV=/dev/sdb1 VAULT_NAME=kylo-vault-data VAULT_MOUNT=/srv/kylo-vault ./luks-setup.sh
```

A script:
- rákérdez, tényleg akarod-e (`IGEN`),
- készít egy kulcsfájlt (hogy újraindítás után magától felnyíljon),
- kér egy **tartalék jelszót** — ezt azonnal mentsd a Bitwardenbe,
- formázza, csatolja, és beírja a `crypttab`/`fstab` sorokat.

Utána a mappák:

```bash
sudo mkdir -p /srv/kylo-vault/config /srv/kylo-vault/data
sudo chown -R 1000:1000 /srv/kylo-vault
```

## 3. lépés — a 2. winchester (tükör) titkosítása

```bash
sudo VAULT_DEV=/dev/sdc1 VAULT_NAME=kylo-vault-mirror VAULT_MOUNT=/mnt/disk2 ./luks-setup.sh
sudo mkdir -p /mnt/disk2/kylo-vault
```

## 4. lépés — ellenőrzés újraindítással

```bash
sudo reboot
# majd újra belépve:
lsblk -f
df -h /srv/kylo-vault /mnt/disk2
```

Ha mindkettő csatolva van a reboot után, a titkosítás jól működik.

## 5. lépés — jöhet a Syncthing

Innentől a `README.md` 1. lépésétől folytasd (`docker compose up -d`).

---

## Mit tegyél, ha elveszik a kulcsfájl

A `/root/.kylo-vault-keys/` mappa a szerveren van. Ha a szerver újratelepül,
a **tartalék jelszóval** tudod megnyitni a lemezt:

```bash
sudo cryptsetup open /dev/sdb1 kylo-vault-data
sudo mount /dev/mapper/kylo-vault-data /srv/kylo-vault
```

Ezért kritikus, hogy a tartalék jelszó a Bitwardenben legyen. Kulcsfájl +
jelszó együttes elvesztése = az adat visszahozhatatlan.

## Mi ellen véd és mi ellen nem

| Kockázat | Véd? |
|---|---|
| Valaki elviszi / kiolvassa a lemezt | ✅ igen |
| Kidobott, leselejtezett winchester | ✅ igen |
| Adatközponti technikus kíváncsiskodik | ✅ igen |
| Feltörik a futó szervert (SSH, root) | ❌ nem (futás közben nyitva van) |
| A saját géped fertőzött | ❌ nem |

Ezért marad fontos: erős SSH-kulcs, jelszavas belépés tiltva, Fail2ban, tűzfal.
