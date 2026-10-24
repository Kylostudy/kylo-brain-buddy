#!/usr/bin/env bash
# Stage only: never starts a manager or interrupts the legacy factory.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'Root-approved host installation required'; exit 2; }
SRC="$(cd "$(dirname "$0")" && pwd)"
cd "$SRC"
sha256sum --strict -c SHA256SUMS
for exe in python3 docker ffmpeg ffprobe systemctl; do command -v "$exe" >/dev/null; done
VERSION="$(sha256sum SHA256SUMS | cut -c1-16)"
REL="/opt/kylo-video-factory/releases/$VERSION"
if [ ! -d "$REL" ]; then
  mkdir -p "$REL"
  for file in contract.py storage.py verify.py state.py client.py agent.py inventory.py config.example.json kylo-video-factory.service SHA256SUMS; do
    install -m 644 "$SRC/$file" "$REL/$file"
  done
fi
mkdir -p /var/lib/kylo-video-factory/work /var/lib/kylo-video-factory/recipes /etc/kylo-video-factory
chmod 700 /etc/kylo-video-factory /var/lib/kylo-video-factory
if [ ! -e /etc/kylo-video-factory/config.json ]; then
  install -m 600 "$SRC/config.example.json" /etc/kylo-video-factory/config.json
fi
# No symlink activation, daemon reload, enable, restart or production write here.
python3 "$REL/inventory.py" > /var/lib/kylo-video-factory/inventory.json
echo "Staged release $VERSION; NOT activated, NOT producing. Review inventory, renderer, KyLogic and credentials first."