#!/usr/bin/env bash
# =============================================================================
# Kylo Vault — ügynök (agent)
#
# 15 percenként fut. Két dolgot csinál:
#   1) BEJELENT: megnézi, fel van-e nyitva a titkosított széf, mennyi hely van,
#      milyen könyvtárak vannak benne, mikor futott a tükrözés — és mindezt
#      elküldi a Brainbe.
#   2) LEKÉRDEZ: visszakapja, hogy MELYIK könyvtárak legyenek szinkronban
#      (amit a Kit felületén pipálsz be), és beírja ezeket a
#      /etc/kylo-vault/sync-paths.txt fájlba, amit a tükrözés használ.
#
# Szükséges környezeti változók (/etc/kylo-vault/agent.env):
#   BRAIN_URL        pl. https://project--<id>.lovable.app
#   WORKER_API_TOKEN a worker tokenje
#   VAULT_TENANT_ID  a te tenant azonosítód (uuid)
# =============================================================================
set -euo pipefail

ENV_FILE="${VAULT_AGENT_ENV:-/etc/kylo-vault/agent.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

AGENT_VERSION="1.0.1"
VAULT_ROOT="${VAULT_SRC:-/srv/kylo-vault/data}"
MOUNT_POINT="${VAULT_MOUNT:-/srv/kylo-vault}"
MIRROR_DIR="${VAULT_MIRROR:-/mnt/disk2/kylo-vault}"
MAPPER="${VAULT_MAPPER:-/dev/mapper/kylo-vault-data}"
SYNC_LIST="${VAULT_SYNC_LIST:-/etc/kylo-vault/sync-paths.txt}"
LOG_STATE="${VAULT_STATE_DIR:-/var/lib/kylo-vault}"

: "${BRAIN_URL:?BRAIN_URL hiányzik}"
: "${WORKER_API_TOKEN:?WORKER_API_TOKEN hiányzik}"
: "${VAULT_TENANT_ID:?VAULT_TENANT_ID hiányzik}"

log() { echo "[$(date '+%F %T')] $*"; }

mkdir -p "$LOG_STATE" "$(dirname "$SYNC_LIST")"

# --- állapot összeszedése ----------------------------------------------------
LUKS_OK=false
[ -e "$MAPPER" ] && LUKS_OK=true

MOUNT_OK=false
mountpoint -q "$MOUNT_POINT" && MOUNT_OK=true

DISK_TOTAL=0; DISK_USED=0; DISK_FREE=0
if [ "$MOUNT_OK" = true ]; then
  read -r DISK_TOTAL DISK_USED DISK_FREE < <(df -B1 --output=size,used,avail "$MOUNT_POINT" | tail -1)
fi

MIRROR_USED=0
MIRROR_OK=false
if [ -d "$MIRROR_DIR" ]; then
  MIRROR_OK=true
  MIRROR_USED=$(du -sb "$MIRROR_DIR" 2>/dev/null | awk '{print $1}')
  MIRROR_USED=${MIRROR_USED:-0}
fi

LAST_MIRROR="None"
if [ -f "$LOG_STATE/last-mirror" ]; then
  LAST_MIRROR="\"$(cat "$LOG_STATE/last-mirror")\""
fi

LAST_ERROR="None"
if [ -s "$LOG_STATE/last-error" ]; then
  LAST_ERROR=$(python3 -c 'import json,sys;print(json.dumps(open(sys.argv[1]).read()[-3000:]))' "$LOG_STATE/last-error")
fi

# Pillanatképek (napi mentések) listája
SNAPSHOTS=$(
  if [ -d "$MIRROR_DIR/.snapshots" ]; then
    find "$MIRROR_DIR/.snapshots" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
  fi | python3 -c 'import json,sys;print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))'
)

# --- könyvtárak felderítése (a széf gyökerének első két szintje) -------------
FOLDERS=$(
  if [ -d "$VAULT_ROOT" ]; then
    find "$VAULT_ROOT" -mindepth 1 -maxdepth 2 -type d \
      -not -path '*/.stfolder*' -not -path '*/.stversions*' -print 2>/dev/null | sort
  fi | python3 - "$VAULT_ROOT" <<'PY'
import json, os, subprocess, sys
root = sys.argv[1]
paths = [l.strip() for l in sys.stdin if l.strip()]
out = []
for p in paths:
    try:
        size = int(subprocess.check_output(["du", "-sb", p]).split()[0])
    except Exception:
        size = None
    count = 0
    for _, _, files in os.walk(p):
        count += len(files)
    out.append({
        "path": os.path.relpath(p, root),
        "label": os.path.basename(p),
        "sizeBytes": size,
        "fileCount": count,
    })
print(json.dumps(out))
PY
)

PAYLOAD=$(python3 - <<PY
import json, socket
print(json.dumps({
  "tenantId": "$VAULT_TENANT_ID",
  "host": socket.gethostname(),
  "luksUnlocked": $( [ "$LUKS_OK" = true ] && echo True || echo False ),
  "mountOk": $( [ "$MOUNT_OK" = true ] && echo True || echo False ),
  "diskTotalBytes": $DISK_TOTAL,
  "diskUsedBytes": $DISK_USED,
  "diskFreeBytes": $DISK_FREE,
  "mirrorUsedBytes": $MIRROR_USED,
  "mirrorOk": $( [ "$MIRROR_OK" = true ] && echo True || echo False ),
  "lastMirrorAt": $LAST_MIRROR,
  "lastError": $LAST_ERROR,
  "snapshots": $SNAPSHOTS,
  "agentVersion": "$AGENT_VERSION",
  "folders": $FOLDERS,
}))
PY
)

log "Bejelentkezés a Brainbe…"
RESPONSE=$(curl -sS --max-time 60 -X POST "$BRAIN_URL/api/public/worker/vault-report" \
  -H "Authorization: Bearer $WORKER_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$PAYLOAD") || { log "HIBA: nem sikerült elérni a Braint"; exit 1; }

# --- a bekapcsolt könyvtárak kiírása a szinkron-listába ----------------------
echo "$RESPONSE" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if not d.get("ok"):
    sys.stderr.write("Brain hiba: %s\n" % d.get("error"))
    sys.exit(1)
print("\n".join(d.get("syncPaths", [])))
' > "$SYNC_LIST.tmp" && mv "$SYNC_LIST.tmp" "$SYNC_LIST"

COUNT=$(wc -l < "$SYNC_LIST" | tr -d ' ')
log "Kész. Szinkronra kijelölt könyvtárak: $COUNT (lista: $SYNC_LIST)"
