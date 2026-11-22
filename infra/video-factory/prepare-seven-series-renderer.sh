#!/usr/bin/env bash
# Additive reviewed image preparation only. Never registers data or claims work.
set -euo pipefail
[ "$(id -u)" = 0 ] || exit 2
SRC="${1:?source required}"
VER="${2:?manager version required}"
cd "$SRC/seven-series-renderer"
sha256sum --strict -c SHA256SUMS
HASH="$(sha256sum SHA256SUMS | cut -c1-16)"
STAGE="/opt/kylo-video-factory/renderer-releases/seven-series-$HASH"
mkdir -p "$STAGE"
while read -r sha name; do
  mkdir -p "$STAGE/$(dirname "$name")"
  if [ -e "$STAGE/$name" ]; then
    [ "$(sha256sum "$STAGE/$name" | cut -d' ' -f1)" = "$sha" ] || exit 3
  else install -m 644 "$name" "$STAGE/$name"; fi
done < SHA256SUMS
install -m 644 SHA256SUMS "$STAGE/SHA256SUMS"
(cd "$STAGE" && sha256sum --strict -c SHA256SUMS)
BASE="$(python3 - <<'PY'
import json,subprocess
from pathlib import Path
c=json.loads(Path('/etc/kylo-video-factory/config.json').read_text())
a=json.loads(Path('/etc/kylo-video-factory/reviewed-renderers.json').read_text())
r=a['seven-stories-hu-v1']
expected='sha256:2fad84eb73bfd8938228f09bb52139001e667c445d80a8a93aab19d035acfddb'
assert r==c['renderers']['seven-stories-hu-v1'] and r['reviewed'] is True and r['image']==expected
assert subprocess.check_output(['docker','image','inspect','--format','{{.Id}}',expected],text=True).strip()==expected
print(expected)
PY
)"
ALIAS="kylo-seven-series-base:${BASE#sha256:}"
docker image tag "$BASE" "$ALIAS"
[ "$(docker image inspect --format '{{.Id}}' "$ALIAS")" = "$BASE" ] || exit 3
DOCKER_BUILDKIT=0 docker build --pull=false --build-arg "REVIEWED_FONT_BASE=$ALIAS" --tag "kylo-seven-series:reviewed-$HASH" "$STAGE"
IMAGE="$(docker image inspect --format '{{.Id}}' "kylo-seven-series:reviewed-$HASH")"
[[ "$IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 3
docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 65532:65532 --entrypoint /usr/bin/python3 "$IMAGE" -c 'import subprocess,sys;sys.path.insert(0,"/app/validation");import seven_series,seven_series_media,seven_series_preflight;assert seven_series.contract_export()["total_videos"]==182;p=subprocess.run(["dpkg-query","-W","-f=${Status}\n","fonts-noto-core","fonts-noto-cjk"],capture_output=True,text=True);assert p.returncode==0 and p.stdout.splitlines()==["install ok installed"]*2;print("seven_series_smoke_ok")'
exec 8>/run/lock/kylo-video-production.lock
flock -w 7500 8 || exit 3
python3 - "$IMAGE" "$SRC" "$HASH" "$BASE" <<'PY'
import datetime,json,os,sys
from pathlib import Path
sys.path.insert(0,sys.argv[2])
from seven_series import RENDERER,SCENES,CONTRACT_ID
paths=[Path('/etc/kylo-video-factory/reviewed-renderers.json'),Path('/etc/kylo-video-factory/config.json')]
a,c=[json.loads(p.read_text()) for p in paths]
entry={'image':sys.argv[1],'reviewed':True,'scenes':SCENES}
for old in (a.get(RENDERER),c['renderers'].get(RENDERER)):
    if old is not None and old!=entry: raise SystemExit('immutable_renderer_conflict')
a[RENDERER]=entry;c['renderers'][RENDERER]=entry
for p,data in zip(paths,(a,c)):
    tmp=p.with_suffix('.series.tmp');tmp.write_text(json.dumps(data,indent=2));os.chmod(tmp,0o600);os.replace(tmp,p)
p=Path('/var/lib/kylo-video-factory/seven-series-renderer-status.json')
status={'installed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'renderer':RENDERER,'image':sys.argv[1],'source_release':sys.argv[3],'reviewed_font_base':sys.argv[4],'contract_id':CONTRACT_ID,'scenes':SCENES,'render_started':False,'recipes_registered':False,'production_ready':False}
tmp=p.with_suffix('.series.tmp');tmp.write_text(json.dumps(status,indent=2));os.chmod(tmp,0o600);os.replace(tmp,p)
PY
flock -u 8
python3 "$SRC/self-check-only.py"
echo "SEVEN-I18N: reviewed image $IMAGE installed; no render or paid audio generation"
