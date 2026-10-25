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
if 'ielts-promo-fonts-v1' in entries and entries['ielts-promo-fonts-v1'] != entry:
    raise SystemExit('immutable_renderer_conflict')
entries['ielts-promo-fonts-v1'] = entry
temp = p.with_suffix('.tmp')
temp.write_text(json.dumps(entries, indent=2))
os.chmod(temp, 0o600)
os.replace(temp, p)
PY
bash "$SRC/activate-manager.sh" "$VER"
echo "FONT: reviewed renderer ielts-promo-fonts-v1 installed ($IMAGE); Japanese trial still required; no production submitted"