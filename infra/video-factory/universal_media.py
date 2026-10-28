"""Frozen-and-silent gap QA without altering the approved narration alignment."""
import re
import subprocess
import math
from pathlib import Path
from universal import FactoryError


def intervals(log, kind, total):
    events = [(float(value), action) for action, value in re.findall(kind + r"_(start|end):\s*([\d.]+)", log)]
    opened, result = None, []
    for value, action in events:
        if action == "start": opened = value
        elif opened is not None: result.append((opened, value)); opened = None
    if opened is not None: result.append((opened, total))
    return result


def unprotected_gaps(frozen, silent, protected):
    gaps = []
    for fs, fe in frozen:
        for ss, se in silent:
            pieces = [(max(fs, ss), min(fe, se))]
            for ps, pe in protected:
                next_pieces = []
                for lo, hi in pieces:
                    if hi <= ps or lo >= pe: next_pieces.append((lo, hi))
                    else:
                        if lo < ps: next_pieces.append((lo, ps))
                        if hi > pe: next_pieces.append((pe, hi))
                pieces = next_pieces
            gaps.extend((lo, hi) for lo, hi in pieces if hi - lo > .25)
    return gaps


def detect_gaps(path, duration_ms, captions, cta_start_ms):
    result = subprocess.run(["/usr/bin/ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vf", "freezedetect=n=0.004:d=0.25", "-af", "silencedetect=noise=-40dB:d=0.25", "-f", "null", "-"], capture_output=True, timeout=7200, check=True)
    log = result.stderr.decode("utf8", "replace")
    protected = [(c["start_ms"] / 1000, c["end_ms"] / 1000) for c in captions] + [(cta_start_ms / 1000, duration_ms / 1000)]
    gaps = unprotected_gaps(intervals(log, "freeze", duration_ms / 1000), intervals(log, "silence", duration_ms / 1000), protected)
    return gaps


def frame_plan(total_frames, gaps):
    """Round cuts inward: never remove a moving/audible boundary frame."""
    removed = set()
    for start, end in gaps:
        removed.update(range(max(0, math.ceil(start * 30)), min(total_frames, math.floor(end * 30))))
    kept = [frame for frame in range(total_frames) if frame not in removed]
    if not kept: raise FactoryError('qa_duration', 'empty_cut', 'Cut cannot remove the whole video')
    return kept


def remap_ms(value, kept):
    # Continuous, piecewise frame-time mapping retains within-frame alignment.
    frame = value * 30 / 1000
    return sum(max(0, min(1, frame - source)) for source in kept) * 1000 / 30


def cut_and_remap(path, records, duration_ms, captions, cta_start_ms):
    total = len(records)
    kept = frame_plan(total, detect_gaps(path, duration_ms, captions, cta_start_ms))
    adjusted = [{**c, 'start_ms': remap_ms(c['start_ms'], kept), 'end_ms': remap_ms(c['end_ms'], kept)} for c in captions]
    mapped = [{**records[source], 'frame': target, 'source_frame': source} for target, source in enumerate(kept)]
    if len(kept) == total: return path, mapped, adjusted, {'removed_frames': 0, 'total_frames': total}
    segments = []
    for frame in kept:
        if segments and segments[-1][1] == frame: segments[-1][1] = frame + 1
        else: segments.append([frame, frame + 1])
    if len(segments) > 500: raise FactoryError('qa_duration', 'too_many_cuts', 'Cut plan exceeds bounded segment limit')
    filters = []
    for i, (start, end) in enumerate(segments):
        filters.extend([f'[0:v]trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS[v{i}]', f'[0:a]atrim=start={start/30:.9f}:end={end/30:.9f},asetpts=PTS-STARTPTS[a{i}]'])
    filters.append(''.join(f'[v{i}][a{i}]' for i in range(len(segments))) + f'concat=n={len(segments)}:v=1:a=1[v][a]')
    output = Path(path).with_name('cut-checked.mp4')
    subprocess.run(['/usr/bin/ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(path), '-filter_complex', ';'.join(filters), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-c:a', 'aac', str(output)], check=True, capture_output=True, timeout=7200)
    return output, mapped, adjusted, {'removed_frames': total-len(kept), 'total_frames': len(kept), 'source_frames': kept, 'alignment_preserved': True}


def verify_gaps(path, duration_ms, captions, cta_start_ms):
    gaps = detect_gaps(path, duration_ms, captions, cta_start_ms)
    if gaps: raise FactoryError('qa_duration', 'frozen_silent_gap', 'Unprotected frozen and silent gap remains after cutting', gaps=gaps)
    return {'frozen_silent_checked': True, 'alignment_preserved': True}