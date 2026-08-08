---
name: Kylo Vault helyi ügynök (Vault Agent)
description: Windows/Mac gépről feltöltő ügynök — párosító kód, Bearer token, manifeszt-különbözet, streamelt feltöltés a LUKS széfbe
type: feature
---

# Vault Agent

- Kit oldal: `POST /api/public/cross/kit/vault` (HMAC) új action-ök:
  `agent_pair_code` (6 jegyű kód, 10 perc), `agent_list` (online = utolsó
  életjel < 3 perc), `agent_remove` (token visszavonás).
- Ügynök oldal (Bearer `agent_token`, kivéve a párosítást):
  `POST /api/public/vault/agent/pair | manifest | upload | heartbeat`.
- Táblák: `vault_agents` (csak token-hash), `vault_agent_folders`,
  `vault_agent_files`, `vault_pair_codes`, `vault_agent_events`.
- Tárolás a széfben: `agents/<agent_id>/<mappa-slug>/<relatív út>`.
  A Brain SOSEM tárol fájlt: átfolyatja a VPS `PUT /upload` végpontjára
  (`infra/vault/fileserver/server.js`), ami temp + rename módon ír és
  SHA-256-ot ellenőriz. Max 2 GB/fájl.
- Csak a különbözet megy fel: a manifeszt hash/méret alapján adja a `need` listát.
- Párosítás rate limit: IP-nként 10 hibás próbálkozás percenként.
