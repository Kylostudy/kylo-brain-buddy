#!/usr/bin/env bash
# =============================================================================
# Kylo Vault — LUKS titkosított kötet FÁJLBAN (ha nincs szabad partíció)
#
# Ezt akkor használjuk, ha a szerver lemezei már RAID1-ben vannak és nincs
# külön, üres winchester. Létrehozunk egy nagy fájlt, azt titkosítjuk (LUKS2),
# és mappaként csatoljuk. Ugyanaz a védelem, mint a partíciós LUKS-nál.
#
# Használat:
#   sudo VAULT_SIZE=100G ./luks-file-setup.sh
# =============================================================================
set -euo pipefail

SIZE="${VAULT_SIZE:-100G}"
IMG="${VAULT_IMG:-/var/lib/kylo-vault.img}"
NAME="${VAULT_NAME:-kylo-vault-data}"
MOUNT="${VAULT_MOUNT:-/srv/kylo-vault}"
KEYFILE="/root/.kylo-vault-keys/${NAME}.key"

log() { echo "[$(date '+%F %T')] $*"; }
die() { echo "HIBA: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Root jog kell: futtasd sudo-val."
[ -e "$IMG" ] && die "Már létezik: $IMG (ha újra akarod kezdeni, előbb töröld)."

command -v cryptsetup >/dev/null || {
  log "cryptsetup telepítése…"
  apt-get update -qq && apt-get install -y -qq cryptsetup
}

AVAIL="$(df -BG --output=avail "$(dirname "$IMG")" | tail -1 | tr -dc '0-9')"
WANT="$(echo "$SIZE" | tr -dc '0-9')"
log "Szabad hely: ${AVAIL}G, kért méret: ${WANT}G"
[ "$AVAIL" -gt "$((WANT + 20))" ] || die "Nincs elég szabad hely (min. kért+20G kell)."

echo
echo "=============================================================="
echo " TITKOSÍTOTT SZÉF LÉTREHOZÁSA"
echo "   Fájl:     $IMG  (${SIZE})"
echo "   Csatolás: $MOUNT"
echo "=============================================================="
read -r -p "Írd be nagybetűvel, hogy IGEN, ha folytatjuk: " CONFIRM
[ "$CONFIRM" = "IGEN" ] || die "Megszakítva."

log "Kötetfájl létrehozása (${SIZE})…"
truncate -s "$SIZE" "$IMG"
chmod 600 "$IMG"

mkdir -p "$(dirname "$KEYFILE")"; chmod 700 "$(dirname "$KEYFILE")"
if [ ! -f "$KEYFILE" ]; then
  log "Kulcsfájl generálása: $KEYFILE"
  dd if=/dev/urandom of="$KEYFILE" bs=512 count=8 status=none
  chmod 400 "$KEYFILE"
fi

log "LUKS2 titkosítás…"
cryptsetup luksFormat --type luks2 --batch-mode "$IMG" "$KEYFILE"

log "Tartalék jelszó felvétele — ezt MENTSD A BITWARDENBE!"
cryptsetup luksAddKey --key-file "$KEYFILE" "$IMG"

log "Kötet megnyitása…"
cryptsetup open --key-file "$KEYFILE" "$IMG" "$NAME"

log "Fájlrendszer (ext4)…"
mkfs.ext4 -q -L "$NAME" "/dev/mapper/$NAME"

mkdir -p "$MOUNT"
mount "/dev/mapper/$NAME" "$MOUNT"

# --- Automatikus nyitás újraindítás után -------------------------------------
if ! grep -q "^$NAME " /etc/crypttab 2>/dev/null; then
  echo "$NAME $IMG $KEYFILE luks" >> /etc/crypttab
  log "/etc/crypttab bővítve."
fi
if ! grep -q " $MOUNT " /etc/fstab 2>/dev/null; then
  echo "/dev/mapper/$NAME $MOUNT ext4 defaults,nofail 0 2" >> /etc/fstab
  log "/etc/fstab bővítve."
fi
systemctl daemon-reload || true

mkdir -p "$MOUNT/config" "$MOUNT/data"
chown -R 1000:1000 "$MOUNT"

echo
log "KÉSZ."
df -h "$MOUNT"
echo
echo "A tartalék jelszót MOST mentsd el a Bitwardenbe."
echo "Kulcsfájl: $KEYFILE — ne töröld, és ne másold ki a szerverről."
