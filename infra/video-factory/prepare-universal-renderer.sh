#!/usr/bin/env bash
# Additive reviewed image; no production command or archive mutation.
set -euo pipefail
[ "$(id -u)" = 0 ] || exit 2
SRC="${1:?source required}"
VER="${2:?manager version required}"
cd "$SRC/universal-renderer"
sha256sum --strict -c SHA256SUMS
HASH="$(sha256sum SHA256SUMS | cut -c1-16)"
STAGE="/opt/kylo-video-factory/renderer-releases/universal-$HASH"
mkdir -p "$STAGE"
while read -r sha name; do
  mkdir -p "$STAGE/$(dirname "$name")"
  if [ -e "$STAGE/$name" ]; then
    [ "$(sha256sum "$STAGE/$name" | cut -d' ' -f1)" = "$sha" ] || exit 3
  else
    install -m 644 "$name" "$STAGE/$name"
  fi
done < SHA256SUMS
cp SHA256SUMS "$STAGE/SHA256SUMS"
(cd "$STAGE" && sha256sum --strict -c SHA256SUMS)
docker build --tag "kylo-exam-universal:reviewed-$HASH" "$STAGE"
IMAGE="$(docker image inspect --format '{{.Id}}' "kylo-exam-universal:reviewed-$HASH")"
[[ "$IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 3
exec 9>/run/lock/kylo-video-production.lock
flock -w 7500 9 || { echo 'UNIVERSAL: activation deferred; active video preserved'; exit 3; }
python3 - "$IMAGE" <<'PY'
import json,os,sys,subprocess
from pathlib import Path
p=Path('/etc/kylo-video-factory/reviewed-renderers.json')
entries=json.loads(p.read_text()) if p.exists() else {}
entry={'image':sys.argv[1],'reviewed':True,'scenes':['exam-promo-universal-v1']}
old=entries.get('exam-promo-universal-v1')
if old and old!=entry and subprocess.run(['docker','image','inspect',str(old.get('image',''))],capture_output=True).returncode==0:
    raise SystemExit('immutable_renderer_conflict')
entries['exam-promo-universal-v1']=entry
tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(entries,indent=2));os.chmod(tmp,0o600);os.replace(tmp,p)
PY
# Release lock before manager start; never submits trial, preview or series.
flock -u 9
bash "$SRC/activate-manager.sh" "$VER"
echo "UNIVERSAL: exam-promo-universal-v1 installed ($IMAGE); no production submitted"