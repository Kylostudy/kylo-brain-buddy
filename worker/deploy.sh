#!/usr/bin/env bash
# =============================================================================
# worker/deploy.sh — Zéró leállású (blue-green) frissítés a VPS-en
# =============================================================================
# Mit csinál, sorban:
#   1. Lehúzza a legfrissebb kódot GitHubról (git pull).
#   2. Megnézi, melyik szín aktív most (blue vagy green) → a MÁSIKAT építi fel.
#   3. Felépíti az executor + recorder image-eket az új kóddal.
#   4. Elindítja az új színt, és megvárja, míg a health végpontja zöld lesz.
#   5. Csak ekkor küldi a régi színt szabályos leállásra (drain): az nem vesz
#      fel új munkát, de a már futókat végigcsinálja (max. 45 perc).
#   6. Elmenti az új aktív színt a .active-color fájlba.
#
# A futó munkák NEM szakadnak félbe. Kézzel:  ./deploy.sh
# =============================================================================

set -euo pipefail

WORKER_DIR="${WORKER_DIR:-$(cd "$(dirname "$0")" && pwd)}"
cd "$WORKER_DIR"

REPO_DIR="${REPO_DIR:-$(cd "$WORKER_DIR/.." && pwd)}"
STATE_FILE="$WORKER_DIR/.active-color"
DRAIN_TIMEOUT_S="${DEPLOY_DRAIN_TIMEOUT_S:-2700}"   # 45 perc a régi színnek
HEALTH_TIMEOUT_S="${DEPLOY_HEALTH_TIMEOUT_S:-300}"  # 5 perc az újnak felállni

log() { echo "[deploy $(date -u +%FT%TZ)] $*"; }

# ---- 1. Melyik szín aktív? --------------------------------------------------
OLD="$(cat "$STATE_FILE" 2>/dev/null || echo "")"
if [ "$OLD" != "blue" ] && [ "$OLD" != "green" ]; then
  # Nincs állapotfájl: kitaláljuk a futó konténerekből.
  if docker ps --format '{{.Names}}' | grep -q 'orchestrator-green'; then
    OLD="green"
  elif docker ps --format '{{.Names}}' | grep -q 'orchestrator-blue'; then
    OLD="blue"
  else
    OLD=""
  fi
fi

if [ -z "$OLD" ]; then
  NEW="blue"
  log "Nincs aktív készlet — első indítás BLUE színnel."
else
  NEW=$([ "$OLD" = "blue" ] && echo "green" || echo "blue")
  log "Aktív most: $OLD → új készlet: $NEW"
fi

# ---- 2. Friss kód -----------------------------------------------------------
log "Kód frissítése GitHubról ($REPO_DIR)…"
git -C "$REPO_DIR" pull --ff-only
log "Verzió: $(git -C "$REPO_DIR" rev-parse --short HEAD) — $(git -C "$REPO_DIR" log -1 --pretty=%s)"

# ---- 3. Építés (a futó színt ez nem érinti) --------------------------------
log "Executor image építése…"
docker compose build executor-image
log "$NEW készlet építése…"
docker compose --profile "$NEW" build

# ---- 4. Új szín indítása ----------------------------------------------------
# FONTOS: nincs --remove-orphans, különben lelőné a másik színt!
log "$NEW készlet indítása…"
docker compose --profile "$NEW" up -d --no-deps shots
docker compose --profile "$NEW" up -d "orchestrator-$NEW" "recorder-$NEW"

log "Várom, hogy a $NEW készlet egészséges legyen (max ${HEALTH_TIMEOUT_S}s)…"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_S ))
ok=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if docker compose exec -T "orchestrator-$NEW" wget -qO- http://127.0.0.1:9090/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 5
done

if [ "$ok" -ne 1 ]; then
  log "HIBA: a $NEW készlet nem lett egészséges. Visszalépés — a régi ($OLD) fut tovább."
  docker compose --profile "$NEW" stop "orchestrator-$NEW" "recorder-$NEW" || true
  docker compose --profile "$NEW" rm -f "orchestrator-$NEW" "recorder-$NEW" || true
  exit 1
fi
log "$NEW készlet egészséges, átveszi a munkát."

# ---- 5. Régi szín szabályos leállítása (drain) ------------------------------
if [ -n "$OLD" ]; then
  log "$OLD készlet szabályos leállítása — a futó munkákat kivárom (max $((DRAIN_TIMEOUT_S/60)) perc)…"
  docker compose --profile "$OLD" stop -t "$DRAIN_TIMEOUT_S" "orchestrator-$OLD" "recorder-$OLD" || true
  docker compose --profile "$OLD" rm -f "orchestrator-$OLD" "recorder-$OLD" || true
  log "$OLD készlet leállt."
fi

# ---- 6. Állapot mentése -----------------------------------------------------
echo "$NEW" > "$STATE_FILE"
log "KÉSZ. Aktív készlet: $NEW"
