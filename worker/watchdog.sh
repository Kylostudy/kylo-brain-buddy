#!/bin/sh
# worker/watchdog.sh
#
# Gépszintű őr. Percenként lefut (systemd timer vagy cron), és gondoskodik róla,
# hogy a teljes worker stack fusson. Ez fogja meg azt az esetet, amit a Docker
# restart policy NEM: ha az egész compose stack leállt (docker daemon újraindult,
# gép rebootolt, valaki lestoppolta), akkor magától visszajön.
#
# Telepítés: lásd worker/README.md → "Öngyógyítás".

set -eu

WORKER_DIR="${WORKER_DIR:-/home/kylo/kylo-worker/worker}"
cd "$WORKER_DIR"

log() { echo "[watchdog $(date -u +%FT%TZ)] $*"; }

# 1) Fut-e egyáltalán a stack?
RUNNING="$(docker compose ps --services --filter status=running 2>/dev/null || true)"

need_up=0
for svc in orchestrator recorder shots autoheal; do
  if ! echo "$RUNNING" | grep -qx "$svc"; then
    log "hiányzik: $svc"
    need_up=1
  fi
done

if [ "$need_up" -eq 1 ]; then
  log "stack indítása (docker compose up -d --remove-orphans)"
  docker compose up -d --remove-orphans
  exit 0
fi

# 2) Fut, de befagyott-e? Az orchestrator health portja megmondja.
if ! docker compose exec -T orchestrator wget -qO- http://127.0.0.1:9090/health >/dev/null 2>&1; then
  log "orchestrator health nem válaszol — újraindítás"
  docker compose restart orchestrator
fi

log "ok"
