#!/usr/bin/env bash
# =============================================================================
# worker/deploy-poll.sh — "Egygombos" frissítés a Brainből + automatikus publish-detektálás
# =============================================================================
# Percenként lefut (systemd timer vagy cron), és megkérdezi a Braintől: kért-e
# valaki frissítést? Emellett megnézi a GitHubot is: érkezett-e újabb commit,
# mint amit a VPS helyben tartalmaz. Ha igen, automatikusan berak egy kérést.
#
# Így a Lovable Publish gombja után a VPS is frissül magától, külön gombnyomás
# nélkül. A futó munkák nem szakadnak félbe.
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
REPO_DIR="${REPO_DIR:-$(cd "$WORKER_DIR/.." && pwd)}"

log() { echo "[deploy-poll $(date -u +%FT%TZ)] $*"; }

# Egyszerre csak egy frissítés futhat.
exec 9>"$LOCK"
if ! flock -n 9; then
  log "már fut egy frissítés, kilépek"
  exit 0
fi

# -----------------------------------------------------------------------------
# 1. Automatikus publish-detektálás: van-e új commit a GitHubon?
# -----------------------------------------------------------------------------
auto_request_id=""
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch origin main --quiet 2>/dev/null || true
  LOCAL_HEAD="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo "")"
  REMOTE_HEAD="$(git -C "$REPO_DIR" rev-parse origin/main 2>/dev/null || echo "")"

  if [ -n "$LOCAL_HEAD" ] && [ -n "$REMOTE_HEAD" ] && [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
    log "új commit a GitHubon: helyi=$LOCAL_HEAD távoli=$REMOTE_HEAD"
    REQ_RESP="$(curl -sS -L --max-time 30 \
      -X POST "${BRAIN_URL%/}/api/public/worker/deploy-request" \
      -H "Authorization: Bearer $WORKER_API_TOKEN" \
      -H "Content-Type: application/json" \
      --post301 --post302 --post303 \
      -d "{\"workerId\":\"$WORKER_ID\",\"note\":\"Automatikus frissítés: új commit érkezett a GitHubra ($REMOTE_HEAD)\"}" || echo '{"ok":false}')"

    if printf '%s' "$REQ_RESP" | grep -q '"ok":true'; then
      auto_request_id="$(printf '%s' "$REQ_RESP" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
      if [ -n "$auto_request_id" ]; then
        log "automatikus frissítési kérés létrehozva: $auto_request_id"
      fi
    else
      log "automatikus kérés nem készült el: $(printf '%s' "$REQ_RESP" | head -c 200)"
    fi
  fi
fi

# -----------------------------------------------------------------------------
# 2. Meglévő kérés lefoglalása (kézi vagy az imént létrehozott automatikus)
# -----------------------------------------------------------------------------
RESP="$(curl -sS -L --max-time 30 -o /tmp/kylo-deploy-claim.out -w '%{http_code}' \
  -X POST "${BRAIN_URL%/}/api/public/worker/deploy-claim" \
  -H "Authorization: Bearer $WORKER_API_TOKEN" \
  -H "Content-Type: application/json" \
  --post301 --post302 --post303 \
  -d "{\"workerId\":\"$WORKER_ID\"}" || echo 000)"
CLAIM="$(cat /tmp/kylo-deploy-claim.out 2>/dev/null || true)"

case "$RESP" in
  204) exit 0 ;;                        # nincs kért frissítés — ez a normális
  200) : ;;                             # van munka, megyünk tovább
  000) log "HIBA: a Brain nem elérhető ($BRAIN_URL)"; exit 0 ;;
  404) log "HIBA: a /api/public/worker/deploy-claim végpont nem létezik az éles Brainen — publikálni kell a Lovable appot!"; exit 0 ;;
  401) log "HIBA: érvénytelen WORKER_API_TOKEN (401)"; exit 0 ;;
  30[1278]) log "HIBA: a Brain átirányít ($RESP). A worker/.env BRAIN_URL értéke valószínűleg rossz (http:// vagy régi cím). Helyes: BRAIN_URL=https://brain.kylosystems.com"; exit 0 ;;
  *)   log "HIBA: váratlan válasz a Braintől ($RESP): $(printf '%s' "$CLAIM" | head -c 200)"; exit 0 ;;
esac

REQ_ID="$(printf '%s' "$CLAIM" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [ -z "$REQ_ID" ]; then
  log "HIBA: nem találtam kérés-azonosítót a válaszban: $(printf '%s' "$CLAIM" | head -c 200)"
  exit 0
fi

log "frissítési kérés felvéve: $REQ_ID"

report() { # report <status> <logfile> [error]
  local status="$1" file="$2" err="${3:-}"
  local body
  body="$(WORKER_STATUS="$status" WORKER_ERR="$err" REQ_ID="$REQ_ID" LOGFILE="$file" \
    python3 - <<'PY'
import json, os
from pathlib import Path

logfile = Path(os.environ["LOGFILE"])
active_file = Path(".active-color")
log = logfile.read_text(errors="replace")[-100000:] if logfile.exists() else ""
active_color = active_file.read_text(errors="replace").strip() if active_file.exists() else None

print(json.dumps({
    "id": os.environ["REQ_ID"],
    "status": os.environ["WORKER_STATUS"],
    "log": log,
    "error": os.environ.get("WORKER_ERR") or None,
    "activeColor": active_color,
}))
PY
  )"
  curl -sS -L --post301 --post302 --post303 --max-time 30 -X POST "${BRAIN_URL%/}/api/public/worker/deploy-status" \
    -H "Authorization: Bearer $WORKER_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body" >/dev/null || true
}

LOGFILE="/tmp/kylo-deploy-$REQ_ID.log"
: > "$LOGFILE"

report running "$LOGFILE"

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
