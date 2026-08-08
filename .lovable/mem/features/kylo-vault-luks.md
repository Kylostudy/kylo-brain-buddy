---
name: kylo-vault-luks
description: A Kylo Vault LUKS2 fájl-kötetben; a VPS két NVMe-je már RAID1, ezért nincs külön tükrözendő lemez
type: feature
---

Döntés: a Tresorit-pótló széf titkosított, MIELŐTT a Syncthing elindul.

Fontos szervertény: a fő VPS két NVMe-je **RAID1**-ben fut (md0/md1/md2), tehát
minden írás valós időben mindkét fizikai lemezre kerül. Külön „2. winchesterre
tükrözés" NEM kell, és nincs is szabad partíció.

- `infra/vault/luks-file-setup.sh` — fájl-alapú LUKS2 kötet (`/var/lib/kylo-vault.img`,
  alap 100G) → `/srv/kylo-vault`. Ezt használjuk ezen a szerveren.
- `infra/vault/luks-setup.sh` — partíciós változat, csak olyan jövőbeli VPS-hez,
  ahol van üres lemez.
- Kulcsfájl: `/root/.kylo-vault-keys/<name>.key` (crypttab = automatikus nyitás reboot után).
- Tartalék jelszó KÖTELEZŐEN Bitwardenbe. Kulcsfájl + jelszó elvesztése = visszahozhatatlan adat.
- Sorrend mindig: LUKS → Syncthing `docker compose up -d` → ufw 22000 → verziótörténet.
- Véletlen törlés ellen: Syncthing Staggered versioning 30 nap + napi hardlink pillanatképek
  (`kylo-vault-mirror.timer`, VAULT_ALLOW_SAME_DISK=1).
- Tresorit lemondás csak akkor, ha a Syncthing "Up to Date" és a fájlok a széfben látszanak.
