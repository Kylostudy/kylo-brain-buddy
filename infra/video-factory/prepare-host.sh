#!/usr/bin/env bash
# Fixed host prerequisites only; never touches archives or starts production.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'VF: host előkészítéshez root szükséges'; exit 2; }
missing=0
for exe in ffmpeg ffprobe openssl; do
  command -v "$exe" >/dev/null || missing=1
done
if [ "$missing" = 1 ]; then
  command -v apt-get >/dev/null || { echo 'VF: támogatott host csomagkezelő szükséges'; exit 3; }
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o DPkg::Lock::Timeout=60 update -qq
  apt-get -o DPkg::Lock::Timeout=60 install -y --no-install-recommends ffmpeg openssl
fi
for exe in ffmpeg ffprobe openssl; do
  command -v "$exe" >/dev/null || { echo "VF: hostprogram telepítése sikertelen: $exe"; exit 4; }
done
echo 'VF: videóellenőrző és titkosító hostprogramok elérhetők'