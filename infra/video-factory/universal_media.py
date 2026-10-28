"""Frozen-and-silent gap QA without altering the approved narration alignment."""
import re
import subprocess
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


def verify_gaps(path, duration_ms, captions, cta_start_ms):
    result = subprocess.run(["/usr/bin/ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vf", "freezedetect=n=0.004:d=0.25", "-af", "silencedetect=noise=-40dB:d=0.25", "-f", "null", "-"], capture_output=True, timeout=7200, check=True)
    log = result.stderr.decode("utf8", "replace")
    protected = [(c["start_ms"] / 1000, c["end_ms"] / 1000) for c in captions] + [(cta_start_ms / 1000, duration_ms / 1000)]
    gaps = unprotected_gaps(intervals(log, "freeze", duration_ms / 1000), intervals(log, "silence", duration_ms / 1000), protected)
    if gaps:
        # Never silently shorten supplied alignment; repair recipe then retry.
        raise FactoryError("qa_duration", "frozen_silent_gap", "Unprotected frozen and silent gap; alignment-preserving correction required", gaps=gaps)
    return {"frozen_silent_checked": True, "protected_windows": protected, "alignment_preserved": True}