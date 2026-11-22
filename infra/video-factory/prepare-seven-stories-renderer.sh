#!/usr/bin/env bash
# Additive seven-story renderer: install + render-free self-check only. No recipe, narration, render or series.
set -euo pipefail
[ "$(id -u)" = 0 ] || exit 2
SRC="${1:?source required}"
VER="${2:?manager version required}"
cd "$SRC/seven-stories-renderer"
sha256sum --strict -c SHA256SUMS
HASH="$(sha256sum SHA256SUMS | cut -c1-16)"
STAGE="/opt/kylo-video-factory/renderer-releases/seven-stories-$HASH"
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
else: raise SystemExit('seven_reviewed_font_base_unavailable')
PY
)"
[[ "$BASE" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 3
docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 65532:65532 --entrypoint /usr/bin/python3 "$BASE" -c 'import subprocess; p=subprocess.run(["dpkg-query","-W","-f=${Status}\n","fonts-noto-core"],capture_output=True,text=True); assert p.returncode==0 and p.stdout.splitlines()==["install ok installed"], "seven_font_packages_unavailable"'
# Dockerfile FROM interprets a bare sha256 image ID as a remote repository.
# Use an isolated local alias, verified back to the full reviewed ID, with the
# classic builder so it consumes the local image instead of resolving a registry.
BASE_ALIAS="kylo-seven-reviewed-base:${BASE#sha256:}"
docker image tag "$BASE" "$BASE_ALIAS"
[ "$(docker image inspect --format '{{.Id}}' "$BASE_ALIAS")" = "$BASE" ] || exit 3
DOCKER_BUILDKIT=0 docker build --pull=false --build-arg "REVIEWED_FONT_BASE=$BASE_ALIAS" --tag "kylo-seven-stories:reviewed-$HASH" "$STAGE"
[ "$(docker image inspect --format '{{.Id}}' "$BASE_ALIAS")" = "$BASE" ] || exit 3
IMAGE="$(docker image inspect --format '{{.Id}}' "kylo-seven-stories:reviewed-$HASH")"
[[ "$IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 3
docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 65532:65532 --entrypoint /bin/echo "$IMAGE" image_ok
# Render-free smoke: pinned validators import, the trial contract rejects an empty recipe, tools exist.
docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 65532:65532 --entrypoint /usr/bin/python3 "$IMAGE" -c 'import sys,shutil;sys.path.insert(0,"/app/validation");import seven_stories,seven_media;assert seven_stories.diagnose({});assert shutil.which("ffmpeg") and shutil.which("bun") and shutil.which("/usr/bin/chromium");print("seven_smoke_ok")'
exec 8>/run/lock/kylo-video-production.lock
flock -w 7500 8 || { echo 'SEVEN: active production preserved'; exit 3; }
# Exact additive change only; prep never activates the manager or registers recipes. Never repair/replace an occupied renderer ID here.
python3 - "$IMAGE" "$SRC" "$BASE" "$HASH" <<'PY'
import datetime,hashlib,json,os,sys
from pathlib import Path
p=Path('/etc/kylo-video-factory/reviewed-renderers.json')
entries=json.loads(p.read_text())
sys.path.insert(0,sys.argv[2])
from seven_stories import SCENES, contract_export
entry={'image':sys.argv[1],'reviewed':True,'scenes':SCENES}
old=entries.get('seven-stories-hu-v1')
if old is not None and old!=entry: raise SystemExit('immutable_renderer_conflict')
config=json.loads(Path('/etc/kylo-video-factory/config.json').read_text())
old_config=config.get('renderers',{}).get('seven-stories-hu-v1')
if old_config is not None and old_config!=entry: raise SystemExit('immutable_renderer_conflict')
if old is None:
    entries['seven-stories-hu-v1']=entry
    temp=p.with_suffix('.seven.tmp');temp.write_text(json.dumps(entries,indent=2));os.chmod(temp,0o600);os.replace(temp,p)
config['renderers']['seven-stories-hu-v1']=entry
c=Path('/etc/kylo-video-factory/config.json')
temp=c.with_suffix('.seven.tmp');temp.write_text(json.dumps(config,indent=2));os.chmod(temp,0o600);os.replace(temp,c)
status={'installed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'renderer':'seven-stories-hu-v1','image':sys.argv[1],'reviewed_font_base':sys.argv[3],'source_release':sys.argv[4],'scenes':SCENES,'contract_id':contract_export()['contract_id'],'approved_inputs_sha256':contract_export()['approved_inputs_sha256'],'render_started':False,'recipes_registered':False,'production_ready':False}
p=Path('/var/lib/kylo-video-factory/seven-stories-renderer-status.json')
temp=p.with_suffix('.seven.tmp');temp.write_text(json.dumps(status,indent=2));os.chmod(temp,0o600);os.replace(temp,p)
PY
# A separate diagnostic process sends only its own event, never starts the manager.
python3 "$SRC/self-check-only.py"
echo "SEVEN: seven-stories-hu-v1 installed ($IMAGE); seven fixed Hungarian scenes; no render, narration, recipe or series"
