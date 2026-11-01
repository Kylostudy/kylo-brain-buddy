#!/usr/bin/env bash
# Root-reviewed additive renderer release. No trials, no series, no archive writes.
set -euo pipefail
[ "$(id -u)" = 0 ] || exit 2
SRC="${1:?source required}"
VER="${2:?manager version required}"
cd "$SRC/ielts-renderer"
sha256sum --strict -c SHA256SUMS
HASH="$(sha256sum SHA256SUMS | cut -c1-16)"
STAGE="/opt/kylo-video-factory/renderer-releases/$HASH"
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
docker build --tag "kylo-ielts-fonts:reviewed-$HASH" "$STAGE"
IMAGE="$(docker image inspect --format '{{.Id}}' "kylo-ielts-fonts:reviewed-$HASH")"
[[ "$IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 3
# Wait for the shared production lock; never interrupt a video or mutate its image.
exec 9>/run/lock/kylo-video-production.lock
flock -w 7500 9 || { echo 'FONT: active production preserved; activation deferred'; exit 3; }
python3 - "$IMAGE" <<'PY'
import json, os, sys
from pathlib import Path
p = Path('/etc/kylo-video-factory/reviewed-renderers.json')
entries = json.loads(p.read_text()) if p.exists() else {}
entry = {'image': sys.argv[1], 'reviewed': True, 'scenes': ['ielts-promo-v1']}
existing = entries.get('ielts-promo-fonts-v1')
if existing is not None and existing != entry:
    import re, subprocess
    old_image = str(existing.get('image', ''))
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', old_image) or {**existing, 'image': entry['image']} != entry:
        raise SystemExit('immutable_renderer_conflict')
    # A failed inspect alone is not proof of absence (daemon/permission failures).
    probe = subprocess.run(['docker', 'image', 'inspect', old_image], capture_output=True, timeout=30)
    if probe.returncode == 0:
        raise SystemExit('immutable_renderer_conflict')
    inventory = subprocess.run(['docker', 'image', 'ls', '--all', '--quiet', '--no-trunc'], capture_output=True, text=True, timeout=30)
    if inventory.returncode != 0:
        raise SystemExit('renderer_inventory_unavailable')
    images = inventory.stdout.splitlines()
    if any(not re.fullmatch(r'sha256:[a-f0-9]{64}', image) for image in images):
        raise SystemExit('renderer_inventory_unavailable')
    if old_image in images:
        raise SystemExit('renderer_probe_failed')
    # Only a digest proven absent from a successful full local inventory is repaired.
entries['ielts-promo-fonts-v1'] = entry
temp = p.with_suffix('.tmp')
temp.write_text(json.dumps(entries, indent=2))
os.chmod(temp, 0o600)
os.replace(temp, p)
PY
bash "$SRC/activate-manager.sh" "$VER"
echo "FONT: reviewed renderer ielts-promo-fonts-v1 installed ($IMAGE); Japanese trial still required; no production submitted"