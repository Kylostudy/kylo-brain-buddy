#!/usr/bin/env bash
# tight-cut.sh — removes only frames that are BOTH visually frozen AND silent
# in a given language track. Never touches moving/visible content, and never
# trims the raised gold dog CTA or the black outro beats.
#
# Usage: scripts/tight-cut.sh <input.mp4> <output.mp4> [outro_lock_sec]
#
# Method:
#  1. ffmpeg `freezedetect` -> candidate frozen video windows
#  2. ffmpeg `silencedetect` -> candidate silent audio windows
#  3. Intersect the two (freeze ∩ silence); anything with motion OR audio
#     is kept untouched.
#  4. Protect the last N seconds (CTA + outro) from any cut.
#  5. Concat only the kept segments.
set -euo pipefail

IN="${1:?input.mp4 required}"
OUT="${2:?output.mp4 required}"
OUTRO_LOCK_SEC="${3:-3.5}"
FREEZE_NOISE="${FREEZE_NOISE:-0.004}"
FREEZE_MIN_DUR="${FREEZE_MIN_DUR:-0.25}"
SILENCE_DB="${SILENCE_DB:--40dB}"
SILENCE_MIN_DUR="${SILENCE_MIN_DUR:-0.25}"
PROTECTED_WINDOWS_JSON="${PROTECTED_WINDOWS_JSON:-[]}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")"
LOCK_START="$(python3 -c "print(max(0, $DURATION - $OUTRO_LOCK_SEC))")"

ffmpeg -hide_banner -nostats -v info -i "$IN" -vf "freezedetect=n=${FREEZE_NOISE}:d=${FREEZE_MIN_DUR}" -map 0:v -f null - 2> "$WORK/freeze.log"
python3 - "$WORK/freeze.log" "$WORK/freeze.json" <<'PY'
import re, sys, json
log = open(sys.argv[1]).read()
starts = [float(m) for m in re.findall(r'freeze_start:\s*([\d.]+)', log)]
ends = [float(m) for m in re.findall(r'freeze_end:\s*([\d.]+)', log)]
json.dump(list(zip(starts, ends)), open(sys.argv[2], 'w'))
PY

ffmpeg -hide_banner -nostats -v info -i "$IN" -af "silencedetect=noise=${SILENCE_DB}:d=${SILENCE_MIN_DUR}" -f null - 2> "$WORK/silence.log"
python3 - "$WORK/silence.log" "$WORK/silence.json" <<'PY'
import re, sys, json
log = open(sys.argv[1]).read()
starts = [float(m) for m in re.findall(r'silence_start:\s*([\d.]+)', log)]
ends = [float(m) for m in re.findall(r'silence_end:\s*([\d.]+)', log)]
json.dump(list(zip(starts, ends)), open(sys.argv[2], 'w'))
PY

python3 - "$WORK/freeze.json" "$WORK/silence.json" "$DURATION" "$LOCK_START" "$WORK/cuts.json" "$PROTECTED_WINDOWS_JSON" <<'PY'
import json, sys
freeze = json.load(open(sys.argv[1]))
silence = json.load(open(sys.argv[2]))
duration = float(sys.argv[3])
lock_start = float(sys.argv[4])

def intersect(a, b):
    out = []
    for fs, fe in a:
        for ss, se in b:
            lo, hi = max(fs, ss), min(fe, se)
            if hi - lo > 0.05:
                out.append((lo, hi))
    return out

cuts = [(max(0, s), min(e, lock_start)) for s, e in intersect(freeze, silence) if s < lock_start]
cuts = [c for c in cuts if c[1] - c[0] > 0.05]
for start, end in json.loads(sys.argv[6]):
    protected_start, protected_end = float(start), float(end)
    if protected_start < 0 or protected_end < protected_start:
        raise ValueError('Invalid protected pause interval')
    remaining = []
    for lo, hi in cuts:
        if hi <= protected_start or lo >= protected_end:
            remaining.append((lo, hi))
        else:
            if lo < protected_start:
                remaining.append((lo, protected_start))
            if hi > protected_end:
                remaining.append((protected_end, hi))
    cuts = remaining
cuts = [c for c in cuts if c[1] - c[0] > 0.05]
cuts.sort()
merged = []
for lo, hi in cuts:
    if merged and lo <= merged[-1][1]:
        merged[-1] = (merged[-1][0], max(hi, merged[-1][1]))
    else:
        merged.append((lo, hi))
cuts = merged
json.dump(cuts, open(sys.argv[5], 'w'))
print(f"[tight-cut] freeze windows={len(freeze)} silence windows={len(silence)} "
      f"frozen+silent cuts(outside last {duration-lock_start:.2f}s)={len(cuts)}", file=sys.stderr)
PY

CUTS="$(cat "$WORK/cuts.json")"
if [ "$CUTS" = "[]" ]; then
  echo "[tight-cut] no frozen+silent frames found — copying input unchanged"
  cp "$IN" "$OUT"
  exit 0
fi

python3 - "$WORK/cuts.json" "$DURATION" "$WORK/keep.txt" <<'PY'
import json, sys
cuts = json.load(open(sys.argv[1]))
duration = float(sys.argv[2])
cursor = 0.0
keeps = []
for s, e in cuts:
    if s > cursor:
        keeps.append((cursor, s))
    cursor = max(cursor, e)
if cursor < duration:
    keeps.append((cursor, duration))
with open(sys.argv[3], 'w') as f:
    for s, e in keeps:
        if e - s > 0.02:
            f.write(f"{s:.3f} {e:.3f}\n")
PY

i=0
SEGLIST="$WORK/segments.txt"
: > "$SEGLIST"
while read -r s e; do
  seg="$WORK/seg_$i.mp4"
  ffmpeg -nostdin -v error -y -ss "$s" -to "$e" -i "$IN" -c:v libx264 -preset veryfast -crf 16 -c:a aac -b:a 192k "$seg"
  echo "file '$seg'" >> "$SEGLIST"
  i=$((i+1))
done < "$WORK/keep.txt"

ffmpeg -nostdin -v error -y -f concat -safe 0 -i "$SEGLIST" -c copy "$OUT"
REMOVED="$(python3 -c "import json;c=json.load(open('$WORK/cuts.json'));print(round(sum(e-s for s,e in c),2))")"
echo "[tight-cut] wrote $OUT (${REMOVED}s removed, frozen+silent only, outro/CTA tail protected)"
