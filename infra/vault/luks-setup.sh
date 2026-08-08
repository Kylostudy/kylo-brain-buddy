#!/usr/bin/env bash
# =============================================================================
# Kylo Vault — LUKS titkosított kötet létrehozása (1. és/vagy 2. lemezre)
#
# Mit csinál: a megadott lemezt/partíciót titkosítottá teszi (LUKS2), majd
# felcsatolja a megadott mappába. Ettől kezdve a lemezen NEM olvashatók a
# fájlok kulcs nélkül — akkor sem, ha valaki fizikailag hozzáfér a vashoz.
#
# ⚠️ FIGYELEM: a megadott eszközön MINDEN ADAT TÖRLŐDIK.
#
# Használat:
#   sudo VAULT_DEV=/dev/sdb1 VAULT_NAME=kylo-vault-data VAULT_MOUNT=/srv/kylo-vault ./luks-setup.sh
#   sudo VAULT_DEV=/dev/sdc1 VAULT_NAME=kylo-vault-mirror VAULT_MOUNT=/mnt/disk2 ./luks-setup.sh
# =============================================================================
set -euo pipefail

DEV="${VAULT_DEV:-}"
NAME="${VAULT_NAME:-kylo-vault-data}"
MOUNT="${VAULT_MOUNT:-/srv/kylo-vault}"
KEYFILE="/root/.kylo-vault-keys/${NAME}.key"

log() { echo "[$(date '+%F %T')] $*"; }
die() { echo "HIBA: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Root jog kell: futtasd sudo-val."
[ -n "$DEV" ] || die "Add meg az eszközt: VAULT_DEV=/dev/sdb1"
[ -b "$DEV" ] || die "Nem blokkeszköz: $DEV (nézd meg: lsblk -f)"

if mount | grep -q "^$DEV "; then
  die "$DEV jelenleg csatolva van. Előbb: sudo umount $DEV"
fi

command -v cryptsetup >/dev/null || {
  log "cryptsetup telepítése…"
  apt-get update -qq && apt-get install -y -qq cryptsetup
}

echo
echo "=============================================================="
echo " TITKOSÍTÁS BEÁLLÍTÁSA"
echo "   Eszköz:   $DEV"
echo "   Név:      $NAME"
echo "   Csatolás: $MOUNT"
echo
lsblk -f "$DEV" || true
echo
echo " ⚠️  AZ ESZKÖZÖN MINDEN ADAT ELVÉSZ!"
echo "=============================================================="
read -r -p "Írd be nagybetűvel, hogy IGEN, ha folytatjuk: " CONFIRM
[ "$CONFIRM" = "IGEN" ] || die "Megszakítva."

# --- Kulcsfájl (hogy újraindítás után magától felnyíljon) --------------------
mkdir -p "$(dirname "$KEYFILE")"
chmod 700 "$(dirname "$KEYFILE")"
if [ ! -f "$KEYFILE" ]; then
  log "Kulcsfájl generálása: $KEYFILE"
  dd if=/dev/urandom of="$KEYFILE" bs=512 count=8 status=none
  chmod 400 "$KEYFILE"
fi

log "LUKS2 kötet létrehozása…"
cryptsetup luksFormat --type luks2 --batch-mode "$DEV" "$KEYFILE"

log "Tartalék jelszó felvétele (ezt jegyezd fel a Bitwardenbe!)…"
echo "  → Most kér egy jelszót: ez a MENTŐÖV, ha a kulcsfájl elveszne."
cryptsetup luksAddKey --key-file "$KEYFILE" "$DEV"

log "Kötet megnyitása…"
cryptsetup open --key-file "$KEYFILE" "$DEV" "$NAME"

log "Fájlrendszer létrehozása (ext4)…"
mkfs.ext4 -q -L "$NAME" "/dev/mapper/$NAME"

mkdir -p "$MOUNT"
mount "/dev/mapper/$NAME" "$MOUNT"
log "Csatolva ide: $MOUNT"

# --- Automatikus nyitás/csatolás újraindítás után ----------------------------
UUID="$(blkid -s UUID -o value "$DEV")"
if ! grep -q "^$NAME " /etc/crypttab 2>/dev/null; then
  echo "$NAME UUID=$UUID $KEYFILE luks,discard" >> /etc/crypttab
  log "/etc/crypttab bővítve."
fi
if ! grep -q " $MOUNT " /etc/fstab 2>/dev/null; then
  echo "/dev/mapper/$NAME $MOUNT ext4 defaults,nofail 0 2" >> /etc/fstab
  log "/etc/fstab bővítve."
fi

systemctl daemon-reload || true

echo
log "KÉSZ. Ellenőrzés:"
lsblk -f "$DEV"
df -h "$MOUNT"
echo
echo "Fontos: a tartalék jelszót MOST mentsd el a Bitwardenbe."
echo "A kulcsfájl helye: $KEYFILE (ezt ne töröld, és ne másold ki a szerverről)."
