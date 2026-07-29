#!/usr/bin/env bash
# =============================================================================
# worker/deploy-poll.sh — "Egygombos" frissítés a Brainből
# =============================================================================
# Percenként lefut (systemd timer), és megkérdezi a Braintől: kért-e valaki
# frissítést? Ha igen, lefuttatja a deploy.sh-t, és a naplót visszaküldi,
# hogy a Brainben élőben látszódjon.
#
# Így soha nem kell kézzel parancsot gépelni a VPS-en: elég a Brain felületén
# a "Frissítés indítása" gomb.
# =============================================================================

set -euo pipefail

WORKER_DIR="${WORKER_DIR:-$(cd "$(dirname "$0")" && pwd)}"
cd "$WORKER_DIR"

# BRAIN_URL és WORKER_API_TOKEN a worker/.env-ből jön
set -a
# shellcheck disable=SC1091
[ -f "$WORKER_DIR/.env" ] && . "$WORKER_DIR/.env"
set +a

BRAIN_URL="${BRAIN_URL:?BRAIN_URL hiányzik a worker/.env-ből}"
WORKER_API_TOKEN="${WORKER_API_TOKEN:?WORKER_API_TOKEN hiányzik a worker/.env-ből}"
WORKER_ID="${WORKER_ID:-worker-1}"
LOCK="/tmp/kylo-deploy.lock"

log() { echo "[deploy-poll $(date -u +%FT%TZ)] $*"; }

# Egyszerre csak egy frissítés futhat.
exec 9>"$LOCK"
if ! flock -n 9; then
  log "már fut egy frissítés, kilépek"
  exit 0
fi

CLAIM="$(curl -sS --max-time 30 -X POST "${BRAIN_URL%/}/api/public/worker/deploy-claim" \
  -H "Authorization: Bearer $WORKER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"workerId\":\"$WORKER_ID\"}" || true)"

if [ -z "$CLAIM" ]; then
  exit 0   # 204: nincs kért frissítés
fi

REQ_ID="$(printf '%s' "$CLAIM" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [ -z "$REQ_ID" ]; then
  exit 0
fi

log "frissítési kérés felvéve: $REQ_ID"

report() { # report <status> <logfile> [error]
  local status="$1" file="$2" err="${3:-}"
  local body
  body="$(WORKER_STATUS="$status" WORKER_ERR="$err" REQ_ID="$REQ_ID" LOGFILE="$file" \
    node -e '
      const fs=require("fs");
      const log=fs.existsSync(process.env.LOGFILE)?fs.readFileSync(process.env.LOGFILE,"utf8").slice(-100000):"";
      process.stdout.write(JSON.stringify({
        id: process.env.REQ_ID,
        status: process.env.WORKER_STATUS,
        log,
        error: process.env.WORKER_ERR || null,
        activeColor: fs.existsSync(".active-color") ? fs.readFileSync(".active-color","utf8").trim() : null,
      }));
    ')"
  curl -sS --max-time 30 -X POST "${BRAIN_URL%/}/api/public/worker/deploy-status" \
    -H "Authorization: Bearer $WORKER_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body" >/dev/null || true
}

LOGFILE="/tmp/kylo-deploy-$REQ_ID.log"
: > "$LOGFILE"

# Közben félpercenként felküldjük a naplót, hogy élőben látszódjon.
( while sleep 30; do report running "$LOGFILE"; done ) &
TICKER=$!

set +e
WORKER_DIR="$WORKER_DIR" bash "$WORKER_DIR/deploy.sh" >>"$LOGFILE" 2>&1
CODE=$?
set -e

kill "$TICKER" 2>/dev/null || true

if [ "$CODE" -eq 0 ]; then
  report succeeded "$LOGFILE"
  log "frissítés kész ($REQ_ID)"
else
  report failed "$LOGFILE" "deploy.sh kilépési kód: $CODE"
  log "frissítés HIBA ($REQ_ID), kód $CODE"
fi
