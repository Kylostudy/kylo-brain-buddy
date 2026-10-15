#!/usr/bin/env bash
# Kylo élő frissítés kiadója — a host systemd timer 10 percenként futtatja.
# Node 20 konténerben fut, így a host Node-verziója nem számít.
set -uo pipefail
REPO=/opt/kylostudy
OUT=/var/www/updates/kylo
LOG=/var/log/kylo-live-update.log
mkdir -p "$OUT/bundles"
exec >>"$LOG" 2>&1
echo "[$(date -u +%FT%TZ)] indul"
if [ ! -d "$REPO/.git" ]; then
  git clone https://github.com/Kylo-study/kylostudy "$REPO" || { echo "HIBA: clone nem sikerült"; exit 1; }
fi
docker run --rm -v "$REPO:$REPO" -v "$OUT:$OUT" -w "$REPO" node:20-bookworm bash -c '
  command -v zip >/dev/null || (apt-get update -qq && apt-get install -y -qq zip >/dev/null)
  git config --global --add safe.directory '"$REPO"'
  node scripts/live-update-publish.cjs'
code=$?
echo "[$(date -u +%FT%TZ)] kész, kód: $code"
exit $code
