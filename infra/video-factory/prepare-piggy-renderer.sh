#!/usr/bin/env bash
# Additive preparation only: no recipe registration, narration or rendering.
set -euo pipefail
[ "$(id -u)" = 0 ] || exit 2
SRC="${1:?source required}"
VER="${2:?manager version required}"
cd "$SRC/piggy-renderer"
sha256sum --strict -c SHA256SUMS
HASH="$(sha256sum SHA256SUMS | cut -c1-16)"
STAGE="/opt/kylo-video-factory/renderer-releases/piggy-bank-$HASH"
mkdir -p "$STAGE"
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
BASE="$(python3 - <<'PY'
import json,re,subprocess
from pathlib import Path
a=json.loads(Path('/etc/kylo-video-factory/reviewed-renderers.json').read_text())
b=json.loads(Path('/etc/kylo-video-factory/config.json').read_text())['renderers']
for name in ('exam-promo-profiles-safe-v4','exam-promo-profiles-safe-v3'):
    r=a.get(name)
    if not isinstance(r,dict) or r!=b.get(name) or r.get('reviewed') is not True or r.get('scenes')!=[name] or not re.fullmatch(r'sha256:[a-f0-9]{64}',str(r.get('image',''))):
        continue
    p=subprocess.run(['docker','image','inspect','--format','{{.Id}}',r['image']],capture_output=True,text=True)
    if p.returncode==0 and p.stdout.strip()==r['image']:
        print(r['image']);break
else: raise SystemExit('piggy_reviewed_font_base_unavailable')
PY
)"
[[ "$BASE" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 3
docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 65532:65532 --entrypoint /bin/sh "$BASE" -c 'dpkg-query -W -f="${Status}\n" fonts-noto-core fonts-noto-cjk | grep -c "install ok installed" | grep -qx 2'
docker build --pull=false --build-arg "REVIEWED_FONT_BASE=$BASE" --tag "kylo-piggy-bank:reviewed-$HASH" "$STAGE"
IMAGE="$(docker image inspect --format '{{.Id}}' "kylo-piggy-bank:reviewed-$HASH")"
[[ "$IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 3
docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 65532:65532 --entrypoint /bin/echo "$IMAGE" image_ok
exec 8>/run/lock/kylo-video-production.lock
flock -w 7500 8 || { echo 'PIGGY: active production preserved'; exit 3; }
# Exact additive change only. Never repair/replace an occupied renderer ID here.
python3 - "$IMAGE" <<'PY'
import json,os,sys
from pathlib import Path
p=Path('/etc/kylo-video-factory/reviewed-renderers.json')
entries=json.loads(p.read_text())
entry={'image':sys.argv[1],'reviewed':True,'scenes':['piggy-bank-v1']}
old=entries.get('piggy-bank-safe-v1')
if old is not None and old!=entry: raise SystemExit('immutable_renderer_conflict')
config=json.loads(Path('/etc/kylo-video-factory/config.json').read_text())
old_config=config.get('renderers',{}).get('piggy-bank-safe-v1')
if old_config is not None and old_config!=entry: raise SystemExit('immutable_renderer_conflict')
if old is None:
    entries['piggy-bank-safe-v1']=entry
    temp=p.with_suffix('.piggy.tmp');temp.write_text(json.dumps(entries,indent=2));os.chmod(temp,0o600);os.replace(temp,p)
PY
bash "$SRC/activate-manager.sh" "$VER"
echo "PIGGY: piggy-bank-safe-v1 installed ($IMAGE); scene piggy-bank-v1; no production submitted"