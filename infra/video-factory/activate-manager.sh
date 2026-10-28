#!/usr/bin/env bash
# Owner-authorized activation of the long-running outbound manager (kylo-video-factory).
# Fail-closed: needs the verified staged release, the protected machine secret, the
# reviewed IELTS renderer from the Czech trial and a finished continuation preparation.
# Never touches /var/brain/archive content; never restarts during an active render.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'VF-AKT: root szükséges'; exit 2; }
SRC="$(cd "$(dirname "$0")" && pwd)"
VER="${1:?verzió szükséges}"
REL="/opt/kylo-video-factory/releases/$VER"
ETC=/etc/kylo-video-factory
LOG=/var/log/kylo-video-factory-start.log
cd "$SRC"
# Several renderer preparations finish around the same deploy; serialize activations.
exec 9>/run/lock/kylo-video-factory-activate.lock
flock -w 900 9 || { echo 'VF-AKT: másik aktiválás fut, időtúllépés'; exit 4; }
sha256sum --strict -c SHA256SUMS >/dev/null
[ -d "$REL" ] || { echo "VF-AKT: nincs előkészített változat: $VER"; exit 3; }
[ -f "$ETC/machine-secret" ] || { echo 'VF-AKT: hiányzik a gépi titok'; exit 3; }
[ "$(stat -c %a "$ETC/machine-secret")" = 600 ] || { echo 'VF-AKT: gépi titok jogosultsága hibás'; exit 3; }
[ -f "$ETC/ielts-trial.json" ] || { echo 'VF-AKT: hiányzik az ellenőrzött renderelő beállítás'; exit 3; }
[ -f /var/lib/kylo-video-factory/ielts-continuation-status.json ] || { echo 'VF-AKT: a folytatás előkészítése még nem kész'; exit 3; }
if systemctl is-active --quiet kylo-subject-factory.service; then
  echo 'VF-AKT: a régi gyártó még fut, átvétel tiltva'; exit 3
fi
# Complete the staged release with every checksum-listed runtime module (adds inputs.py).
for file in contract.py storage.py verify.py state.py client.py agent.py inventory.py inputs.py universal.py universal_state.py universal_runtime.py universal_media.py; do
  if [ -e "$REL/$file" ]; then
    cmp -s "$SRC/$file" "$REL/$file" || { echo "VF-AKT: eltérő fájl a kiadásban: $file"; exit 3; }
  else
    install -m 644 "$SRC/$file" "$REL/$file"
  fi
done
CONFIG_BEFORE="$(sha256sum "$ETC/config.json" | cut -d' ' -f1)"
python3 - "$ETC" <<'PY'
import json, os, sys
from pathlib import Path
etc = Path(sys.argv[1])
config = json.loads((etc / "config.json").read_text())
roots = config.get("read_roots", {})
if not isinstance(roots, dict) or set(roots) - {"brain-archive"} or roots.get("brain-archive", "/var/brain/archive") != "/var/brain/archive":
    raise SystemExit("VF-AKT: váratlan olvasási archívumgyökér")
config["read_roots"] = {"brain-archive": "/var/brain/archive"}
trial = json.loads((etc / "ielts-trial.json").read_text())
if config.get("agent_id") != "factory-finnish-vps-1":
    raise SystemExit("VF-AKT: váratlan ügynöknév")
if config.get("kylogic_origin") != "https://yqhipzwmgpopelfcenie.supabase.co/functions/v1/video-factory":
    raise SystemExit("VF-AKT: váratlan KyLogic cím")
renderer = trial.get("renderers", {}).get("ielts-promo-v1", {})
if not renderer.get("reviewed") or not str(renderer.get("image", "")).startswith("sha256:"):
    raise SystemExit("VF-AKT: nincs ellenőrzött renderelő")
config["renderers"] = {"ielts-promo-v1": renderer}
extra = etc / "reviewed-renderers.json"
# Fixed allowlist: additive renderer name -> the only scene it may render.
ALLOWED_EXTRA = {"ielts-promo-fonts-v1": ["ielts-promo-v1"], "exam-promo-profiles-v1": ["exam-promo-profiles-v1"], "exam-promo-profiles-safe-v2": ["exam-promo-profiles-safe-v2"], "exam-promo-profiles-safe-v3": ["exam-promo-profiles-safe-v3"], "exam-promo-universal-v1": ["exam-promo-universal-v1"]}
if extra.exists():
    import re
    additions = json.loads(extra.read_text())
    for name, entry in additions.items():
        if name not in ALLOWED_EXTRA or not entry.get("reviewed") or not re.fullmatch(r"sha256:[a-f0-9]{64}", str(entry.get("image", ""))) or entry.get("scenes") != ALLOWED_EXTRA[name]:
            raise SystemExit(f"VF-AKT: nem ellenőrzött kiegészítő renderelő: {name}")
        config["renderers"][name] = entry
config["takeover_approved"] = True
tmp = etc / "config.json.tmp"
tmp.write_text(json.dumps(config, indent=2))
os.chmod(tmp, 0o600)
os.replace(tmp, etc / "config.json")
PY
OLD="$(readlink /opt/kylo-video-factory/current 2>/dev/null || true)"
ln -sfn "$REL" /opt/kylo-video-factory/current.new
mv -T /opt/kylo-video-factory/current.new /opt/kylo-video-factory/current
install -m 644 "$REL/kylo-video-factory.service" /etc/systemd/system/kylo-video-factory.service
systemctl daemon-reload
systemctl enable kylo-video-factory.service >/dev/null 2>&1
if systemctl is-active --quiet kylo-video-factory.service; then
  if [ "$OLD" != "$REL" ] || [ "$CONFIG_BEFORE" != "$(sha256sum "$ETC/config.json" | cut -d' ' -f1)" ]; then
    if docker ps --format '{{.Names}}' | grep -qx kylo-video-factory-render; then
      echo 'VF-AKT: renderelés fut, az újraindítás a következő frissítésre marad'
    else
      # Planned activations must not consume the crash-loop start limit.
      systemctl reset-failed kylo-video-factory.service 2>/dev/null || true
      systemctl restart kylo-video-factory.service
      echo "VF-AKT: új változatra újraindítva: $VER"
    fi
  else
    echo "VF-AKT: már fut ($VER)"
  fi
else
  systemctl reset-failed kylo-video-factory.service 2>/dev/null || true
  systemctl start kylo-video-factory.service
  echo "VF-AKT: elindítva: $VER"
fi
sleep 45
{
  echo "=== $(date -u +%FT%TZ) indítás utáni napló ($VER) ==="
  journalctl -u kylo-video-factory.service -n 30 --no-pager -o short-iso 2>&1 || true
} >> "$LOG"
chmod 600 "$LOG"
echo "VF-AKT: szolgáltatás: $(systemctl is-active kylo-video-factory.service 2>&1 || true)"
journalctl -u kylo-video-factory.service -n 30 --no-pager -o short-iso 2>&1 | sed 's/^/VF-NAPLÓ: /' || true
