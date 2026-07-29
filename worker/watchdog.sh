#!/bin/sh
# worker/watchdog.sh
#
# Gépszintű őr. Percenként lefut (systemd timer vagy cron), és gondoskodik róla,
# hogy a teljes worker stack fusson. Ez fogja meg azt az esetet, amit a Docker
# restart policy NEM: ha az egész compose stack leállt (docker daemon újraindult,
# gép rebootolt, valaki lestoppolta), akkor magától visszajön.
#
# Blue-green: mindig az éppen aktív színt (worker/.active-color) őrizzük.
#
# Telepítés: lásd worker/README.md → "Öngyógyítás".

set -eu

WORKER_DIR="${WORKER_DIR:-/home/kylo/kylo-worker/worker}"
cd "$WORKER_DIR"

log() { echo "[watchdog $(date -u +%FT%TZ)] $*"; }

COLOR="$(cat "$WORKER_DIR/.active-color" 2>/dev/null || echo blue)"
case "$COLOR" in blue|green) ;; *) COLOR=blue ;; esac

# Ha épp frissítés fut, ne szóljunk bele.
if [ -f /tmp/kylo-deploy.lock ] && command -v flock >/dev/null 2>&1; then
  if ! flock -n /tmp/kylo-deploy.lock true; then
    log "frissítés fut, kihagyom ezt a kört"
    exit 0
  fi
fi

# 1) Fut-e egyáltalán a stack?
RUNNING="$(docker compose --profile "$COLOR" ps --services --filter status=running 2>/dev/null || true)"

need_up=0
for svc in "orchestrator-$COLOR" "recorder-$COLOR" shots autoheal; do
  if ! echo "$RUNNING" | grep -qx "$svc"; then
    log "hiányzik: $svc"
    need_up=1
  fi
done

if [ "$need_up" -eq 1 ]; then
  log "aktív ($COLOR) stack indítása"
  docker compose --profile "$COLOR" up -d
  exit 0
fi

# 2) Fut, de befagyott-e? Az orchestrator health portja megmondja.
if ! docker compose exec -T "orchestrator-$COLOR" wget -qO- http://127.0.0.1:9090/health >/dev/null 2>&1; then
  log "orchestrator-$COLOR health nem válaszol — újraindítás"
  docker compose --profile "$COLOR" restart "orchestrator-$COLOR"
fi

log "ok ($COLOR)"
