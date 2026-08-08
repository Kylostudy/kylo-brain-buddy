---
name: Kylo Vault (titkosított széf)
description: LUKS-titkosított széf a VPS-en Tresorit kiváltására; a motor a Brainben, a kezelőfelület a Kitben, csak a gazdi tenantjának
type: feature
---

# Kylo Vault

Cél: a fizetős Tresorit előfizetés kiváltása saját VPS-en. **Nem eladható
felhőszolgáltatás**, kizárólag a gazdi saját használatára.

## Felállás
- **VPS**: LUKS-titkosított fájl-konténer (`/srv/kylo-vault`), RAID1 lemezeken,
  óránkénti rsync-tükrözés a 2. lemezre + 7 napos hardlink pillanatképek.
- **Brain (itt)**: az adatok és a logika. Táblák: `vault_folders`, `vault_status`.
- **Kit**: CSAK a kezelőfelület, a gazdi saját tenantjának dashboardjában.

## Adatáramlás
1. A VPS ügynöke (`infra/vault/agent.sh`, 15 percenként) bejelent a
   `POST /api/public/worker/vault-report` végpontra (Bearer `WORKER_API_TOKEN`).
2. Válaszul visszakapja a bekapcsolt könyvtárak listáját → `/etc/kylo-vault/sync-paths.txt`.
3. A `mirror.sh` ezt a listát használja `rsync --files-from`-mal.
4. A Kit a `POST /api/public/cross/kit/vault` végpontot hívja (Kit↔Brain HMAC,
   `KIT_BRAIN_TASK_SECRET`) — műveletek: `state`, `set_enabled`, `add_folder`,
   `remove_folder`.

A VPS-en nincs nyitott bejövő port: mindig a VPS hívja a Braint.

Opcionális szigorítás: a `VAULT_OWNER_TENANT_ID` környezeti változóval a
Kit-végpont egyetlen tenantra korlátozható.
