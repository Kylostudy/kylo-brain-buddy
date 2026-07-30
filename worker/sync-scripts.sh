#!/usr/bin/env bash
# =============================================================================
# worker/sync-scripts.sh — GYORS frissítés build nélkül (élő szkript mód)
# =============================================================================
# Csak akkor használható, ha a változás kizárólag a becsatolt fájlokat érinti:
#   worker/executor/run.js  és  worker/executor/scripts/**
# Ilyenkor nincs docker build és nincs konténerváltás — a következő futás
# már az új kóddal indul (másodpercek, nem percek).
#
# Biztonsági fékek:
#   * a frissítés előtti commitot megjegyezzük; ha a szintaxis-ellenőrzés bukik,
#     automatikusan visszaállunk rá (git reset --hard), tehát félkész kód
#     SOHA nem kerül futásba;
#   * az orchestrator futás előtt maga is ellenőriz — dupla háló;
#   * a folyamatban lévő futásokat semmi nem zavarja meg.
# =============================================================================

set -euo pipefail

WORKER_DIR="${WORKER_DIR:-$(cd "$(dirname "$0")" && pwd)}"
cd "$WORKER_DIR"
REPO_DIR="${REPO_DIR:-$(cd "$WORKER_DIR/.." && pwd)}"

log() { echo "[sync $(date -u +%FT%TZ)] $*"; }

OLD_HEAD="$(git -C "$REPO_DIR" rev-parse HEAD)"

log "Kód frissítése GitHubról (gyors útvonal, build nélkül)…"
git -C "$REPO_DIR" pull --ff-only
NEW_HEAD="$(git -C "$REPO_DIR" rev-parse HEAD)"
log "Verzió: $(git -C "$REPO_DIR" rev-parse --short HEAD) — $(git -C "$REPO_DIR" log -1 --pretty=%s)"

log "Szintaxis-ellenőrzés az executor szkripteken…"
if ! docker run --rm -v "$WORKER_DIR/executor:/x:ro" node:20-alpine \
  sh -c 'set -e; find /x -name "*.js" -not -path "*/node_modules/*" -print0 | xargs -0 -n1 node --check'; then
  log "HIBA: hibás szkript érkezett — visszaállok a korábbi verzióra ($OLD_HEAD)."
  git -C "$REPO_DIR" reset --hard "$OLD_HEAD"
  exit 1
fi
log "Minden szkript rendben."

if [ "$OLD_HEAD" = "$NEW_HEAD" ]; then
  log "Nem volt új commit — nincs teendő."
else
  log "KÉSZ. A következő futás már az új szkriptekkel indul (nincs újraindítás, nincs leállás)."
fi
