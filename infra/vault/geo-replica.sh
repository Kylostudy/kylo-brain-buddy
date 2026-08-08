#!/usr/bin/env bash
# =============================================================================
# Kylo Vault — MÁSODIK HELYSZÍN (geo-redundancia)
#
# Ezt akkor futtatjuk, amikor lesz egy második VPS-ed egy másik országban.
# A fő VPS naponta egyszer átküldi a széfet a távoli gépre, SSH-n keresztül.
#
# Beállítás a fő VPS-en:
#   ssh-keygen -t ed25519 -f ~/.ssh/kylo-vault -N ""
#   ssh-copy-id -i ~/.ssh/kylo-vault.pub kylo@<masik-vps-ip>
#   export VAULT_REMOTE="kylo@<masik-vps-ip>:/srv/kylo-vault-replica"
# =============================================================================
set -euo pipefail

SRC="${VAULT_SRC:-/srv/kylo-vault/data}"
REMOTE="${VAULT_REMOTE:-}"
SSH_KEY="${VAULT_SSH_KEY:-$HOME/.ssh/kylo-vault}"

log() { echo "[$(date '+%F %T')] $*"; }

if [ -z "$REMOTE" ]; then
  log "Nincs beállítva VAULT_REMOTE — a távoli másolat kihagyva."
  exit 0
fi

log "Távoli másolat indul: $SRC -> $REMOTE"
rsync -aH --delete --numeric-ids --partial --compress \
      -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" \
      --exclude '.stversions/' --exclude '.stfolder/' \
      "$SRC/" "$REMOTE/"
log "Távoli másolat kész."
