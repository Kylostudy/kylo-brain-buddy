#!/usr/bin/env bash
# =============================================================================
# worker/live.sh — az "esti fejlesztői mód" kézi kapcsolója
# =============================================================================
# Használat:
#   ./live.sh on      → mostantól mindig az élő szkriptek futnak (idősávtól függetlenül)
#   ./live.sh off     → mindig a beépített (image) szkriptek futnak
#   ./live.sh auto    → visszaáll az idősávos automatikára (alap: 17:00–08:00)
#   ./live.sh status  → megmutatja, most mi van érvényben
#
# A kapcsolás AZONNALI: nincs konténer-újraindítás, a következő futás már
# az új beállítás szerint indul. A már futó munkákhoz nem nyúlunk.
# =============================================================================

set -euo pipefail
WORKER_DIR="${WORKER_DIR:-$(cd "$(dirname "$0")" && pwd)}"
DIR="$WORKER_DIR/executor"

case "${1:-status}" in
  on)
    rm -f "$DIR/.live-off"
    touch "$DIR/.live-on"
    echo "Élő szkript mód: BE (kényszerítve). A következő futás már a friss fájlokat használja."
    ;;
  off)
    rm -f "$DIR/.live-on"
    touch "$DIR/.live-off"
    echo "Élő szkript mód: KI. Minden futás a bevált, beépített szkriptekkel megy."
    ;;
  auto)
    rm -f "$DIR/.live-on" "$DIR/.live-off"
    echo "Élő szkript mód: AUTOMATIKUS (idősáv szerint, alapból 17:00–08:00)."
    ;;
  status)
    if [ -f "$DIR/.live-off" ]; then echo "kényszerítve KI (.live-off)"
    elif [ -f "$DIR/.live-on" ]; then echo "kényszerítve BE (.live-on)"
    else echo "automatikus (idősáv szerint)"; fi
    for c in blue green; do
      if docker ps --format '{{.Names}}' | grep -q "orchestrator-$c"; then
        echo "--- orchestrator-$c health ---"
        docker compose exec -T "orchestrator-$c" wget -qO- http://127.0.0.1:9090/health || true
        echo
      fi
    done
    ;;
  *)
    echo "Használat: ./live.sh [on|off|auto|status]" >&2
    exit 1
    ;;
esac
