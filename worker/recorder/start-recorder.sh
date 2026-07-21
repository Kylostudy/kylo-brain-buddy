#!/usr/bin/env sh
set -eu

export DISPLAY="${DISPLAY:-:99}"

rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true

echo "[recorder] Xvfb indítása DISPLAY=${DISPLAY}"
Xvfb "$DISPLAY" -screen 0 1280x960x24 -ac +extension GLX +render -noreset >/tmp/xvfb.log 2>&1 &
XVFB_PID="$!"

cleanup() {
  kill "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for attempt in $(seq 1 50); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    echo "[recorder] Xvfb kész"
    exec node boot.js
  fi

  if ! kill -0 "$XVFB_PID" 2>/dev/null; then
    echo "[recorder] Xvfb leállt indítás közben"
    cat /tmp/xvfb.log 2>/dev/null || true
    exit 1
  fi

  sleep 0.1
done

echo "[recorder] Xvfb nem lett kész időben"
cat /tmp/xvfb.log 2>/dev/null || true
exit 1