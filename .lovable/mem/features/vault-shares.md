---
name: Kylo Vault megosztó linkek
description: Lejáró, jelszavas megosztó linkek a széfből — Brain proxyzza a letöltést a VPS csak olvasó fájlkiszolgálójáról
type: feature
---

# Vault megosztások

- Táblák: `vault_shares` (token, jelszó-hash PBKDF2, lejárat, letöltési limit,
  visszavonás), `vault_share_access` (napló: ok/expired/bad_password/limit_reached/
  not_found/revoked/rate_limited).
- Kit-végpont: `POST /api/public/cross/kit/vault` HMAC-kal, új action-ök:
  `share_create`, `share_list`, `share_revoke`.
- Publikus oldal: `https://brain.kylosystems.com/s/<token>`; API:
  `POST /api/public/s/:token`, letöltés `GET /api/public/s/:token/dl`.
- A fájlok SOSEM másolódnak a felhőbe: a Brain a VPS
  `vault.kylosystems.com` (127.0.0.1:8079) csak olvasó fájlkiszolgálójáról
  streameli át. Mappa ZIP-ben, felső határ 5 GB.
- Alapértelmezett lejárat 7 nap; napi pg_cron takarítás 30 nap után.
- Elutasításnál mindig semleges üzenet: „Ez a link már nem érvényes."
