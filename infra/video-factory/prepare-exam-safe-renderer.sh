#!/usr/bin/env bash
# Additive caption-safe Cambridge/IELTS exam-profile renderer. Never trials, series or archive writes; legacy renderer entries stay untouched.
set -euo pipefail
[ "$(id -u)" = 0 ] || exit 2
SRC="${1:?source required}"
VER="${2:?manager version required}"
cd "$SRC/exam-safe-renderer"
sha256sum --strict -c SHA256SUMS
HASH="$(sha256sum SHA256SUMS | cut -c1-16)"
STAGE="/opt/kylo-video-factory/renderer-releases/exam-safe-$HASH"
mkdir -p "$STAGE"
# Only checksum-reviewed files; concurrent deploy cannot change staged sources.
while read -r sha name; do
  name="${name#\*}"
  mkdir -p "$STAGE/$(dirname "$name")"
  if [ -e "$STAGE/$name" ]; then
    [ "$(sha256sum "$STAGE/$name" | cut -d' ' -f1)" = "$sha" ] || exit 3
  else
    install -m 644 "$name" "$STAGE/$name"
  fi
done < SHA256SUMS
cp SHA256SUMS "$STAGE/SHA256SUMS"
(cd "$STAGE" && sha256sum --strict -c SHA256SUMS)
docker build --tag "kylo-exam-profiles-safe:reviewed-$HASH" "$STAGE"
IMAGE="$(docker image inspect --format '{{.Id}}' "kylo-exam-profiles-safe:reviewed-$HASH")"
[[ "$IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 3
# Wait for the shared production lock; never interrupt a video or mutate its image.
exec 9>/run/lock/kylo-video-production.lock
flock -w 7500 9 || { echo 'EXAM: active production preserved; activation deferred'; exit 3; }
python3 - "$IMAGE" <<'PY'
import json, os, sys
from pathlib import Path
p = Path('/etc/kylo-video-factory/reviewed-renderers.json')
entries = json.loads(p.read_text()) if p.exists() else {}
entry = {'image': sys.argv[1], 'reviewed': True, 'scenes': ['exam-promo-profiles-safe-v2']}
existing = entries.get('exam-promo-profiles-safe-v2')
if existing is not None and existing != entry:
    import subprocess
    probe = subprocess.run(['docker', 'image', 'inspect', str(existing.get('image', ''))], capture_output=True)
    if probe.returncode == 0:
        raise SystemExit('immutable_renderer_conflict')
    # A bejegyzett kép már nem létezik a Dockerben: ez helyreállítás, nem felülírás.
entries['exam-promo-profiles-safe-v2'] = entry
temp = p.with_suffix('.tmp')
temp.write_text(json.dumps(entries, indent=2))
os.chmod(temp, 0o600)
os.replace(temp, p)
PY
bash "$SRC/activate-manager.sh" "$VER"
echo "EXAM: reviewed renderer exam-promo-profiles-safe-v2 installed ($IMAGE); scene exam-promo-profiles-safe-v2; no production submitted"