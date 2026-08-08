---
name: kylo-vault-tresorit-replacement
description: Tresorit kiváltása saját VPS-en Syncthinggel, óránkénti tükrözés a 2. winchesterre, később geo-redundancia több VPS-re
type: feature
---

A user le akarja mondani a Tresorit (~15 USD/hó) előfizetést, mert van saját VPS-e.

Megoldás: `infra/vault/`
- **Syncthing** Docker konténer (`kylo-vault`), GUI csak 127.0.0.1:8384 (SSH alagúton át).
- Adat: `/srv/kylo-vault/data`, config: `/srv/kylo-vault/config`.
- VPS oldalon a mappa **Receive Only** + Staggered versioning 30 nap (= Tresorit verziótörténet).
- `mirror.sh` + systemd timer: óránként rsync a 2. winchesterre (`/mnt/disk2/kylo-vault/current`)
  + 7 napos hardlink pillanatképek. Védelem: nem fut, ha a 2. lemez nincs csatolva.
- `geo-replica.sh`: későbbre, ha lesz több VPS más országban (rsync over SSH).

Szabály: a Tresorit előfizetést csak akkor mondja le, ha a Syncthing "Up to Date"
és a tükör mappában is ott vannak a fájlok.
