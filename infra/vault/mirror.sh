#!/usr/bin/env bash
# =============================================================================
# Kylo Vault — tükrözés a MÁSODIK winchesterre + 7 napos verzió-visszamenet
#
# Óránként fut (systemd timer). Két dolgot csinál:
#   1) pontos másolatot készít a 2. lemezre (rsync)
#   2) napi "pillanatképet" tesz félre helytakarékosan (hardlink), így egy
#      véletlen törlés vagy titkosító vírus után 7 napra vissza lehet menni
#
# Beállítás: a VAULT_MIRROR környezeti változóval add meg a 2. lemez útját.
# =============================================================================
set -euo pipefail

SRC="${VAULT_SRC:-/srv/kylo-vault/data}"
DST="${VAULT_MIRROR:-/mnt/disk2/kylo-vault}"
SNAPDIR="$DST/.snapshots"
KEEP_DAYS="${VAULT_KEEP_DAYS:-7}"
TODAY="$(date +%F)"

log() { echo "[$(date '+%F %T')] $*"; }

if [ ! -d "$SRC" ]; then
  log "HIBA: a forrás nem létezik: $SRC"
  exit 1
fi

# A 2. lemeznek CSATOLVA kell lennie, különben a rendszerlemezre tükröznénk.
if ! mountpoint -q "$(dirname "$DST")" && [ "${VAULT_ALLOW_SAME_DISK:-0}" != "1" ]; then
  log "HIBA: a második lemez nincs csatolva ide: $(dirname "$DST")"
  log "      (ha szándékosan ugyanarra a lemezre tükrözöl: VAULT_ALLOW_SAME_DISK=1)"
  exit 1
fi

mkdir -p "$DST/current" "$SNAPDIR"

log "Tükrözés indul: $SRC -> $DST/current"
rsync -aH --delete --numeric-ids \
      --exclude '.stversions/' \
      --exclude '.stfolder/' \
      "$SRC/" "$DST/current/"
log "Tükrözés kész."

# Napi pillanatkép (hardlinkkel, tehát alig foglal helyet)
if [ ! -d "$SNAPDIR/$TODAY" ]; then
  log "Napi pillanatkép készítése: $TODAY"
  cp -al "$DST/current" "$SNAPDIR/$TODAY"
fi

# Régi pillanatképek törlése
find "$SNAPDIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -print -exec rm -rf {} + || true

USED=$(du -sh "$DST" 2>/dev/null | awk '{print $1}')
log "Kész. A tükör mérete: ${USED:-ismeretlen}"
