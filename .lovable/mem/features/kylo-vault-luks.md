---
name: kylo-vault-luks
description: A Kylo Vault lemezei LUKS2-vel titkosítva; kulcsfájl a szerveren, tartalék jelszó Bitwardenben
type: feature
---

Döntés: a Tresorit-pótló széf lemezeit LUKS2-vel titkosítjuk, MIELŐTT a Syncthing elindul.

- `infra/vault/luks-setup.sh` — interaktív script (VAULT_DEV / VAULT_NAME / VAULT_MOUNT).
- 1. lemez: `kylo-vault-data` → `/srv/kylo-vault`; 2. winchester: `kylo-vault-mirror` → `/mnt/disk2`.
- Kulcsfájl: `/root/.kylo-vault-keys/<name>.key` (crypttab automatikus nyitáshoz).
- Tartalék jelszó KÖTELEZŐEN a Bitwardenbe kerül — kulcsfájl + jelszó elvesztése = visszahozhatatlan adat.
- Sorrend mindig: LUKS → mappák+chown 1000:1000 → Syncthing `docker compose up -d`.
- Tresorit lemondás csak akkor, ha Syncthing "Up to Date" ÉS a tükör mappában is ott vannak a fájlok.
