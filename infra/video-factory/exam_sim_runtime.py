"""Host wiring for the single approved Hungarian exam-simulator trial (exam-simulator-safe-v1).

The factory stores a schema-version-1 envelope; the pinned renderer receives a fixed
projection of it.  Acceptance is decided by exam_simulator.diagnose (byte-identical copy
of the renderer's pinned validator).  After rendering, only frames that are both frozen
and silent may be cut, never inside the protected windows.  Trial only: no series.
"""
import json
import math
import subprocess
from pathlib import Path

import exam_simulator as es

ENVELOPE = {"schema_version", "recipe_id", "version", "renderer", "series", "languages", "files", "videos"}


def targeted(raw):
    return isinstance(raw, dict) and (raw.get("renderer") == es.RENDERER or raw.get("recipe_id") == es.RECIPE)


def project(raw):
    """Fixed, lossless projection of the factory envelope to the renderer manifest."""
    return {"recipe": raw.get("recipe_id"), "version": raw.get("version"), "series": raw.get("series"),
            "renderer": raw.get("renderer"), "start_series": False, "files": raw.get("files"), "videos": raw.get("videos")}


def diagnose(raw):
    if not isinstance(raw, dict):
        return ["manifest: object required"]
    errors = []
    extra, missing = set(raw) - ENVELOPE, ENVELOPE - set(raw)
    if extra:
        errors.append("manifest: unknown fields %s" % sorted(extra))
    if missing:
        errors.append("manifest: missing fields %s" % sorted(missing))
    if raw.get("schema_version") != 1:
        errors.append("schema_version: must be 1")
    if raw.get("languages") != ["hu"]:
        errors.append("languages: must be ['hu']")
    return errors + es.diagnose(project(raw))


def validate(raw):
    errors = diagnose(raw)
    if errors:
        raise ValueError("exam_simulator_invalid: " + "; ".join(errors))
    return raw


def request(manifest, video):
    return {"manifest": project(manifest), "video": video}


def protected_ms(video):
    """Scene 5 silent window plus the CTA/black outro from the CTA start to the end."""
    t = video["timing"]
    cta = video["subtitle"][5]["start_ms"]
    return [(a, b) for a, b in t["protected_windows_ms"]] + [(cta, t["duration_ms"])]


def _intervals(log, kind, total):
    import re
    out, opened = [], None
    for action, value in re.findall(kind + r"_(start|end):\s*([\d.]+)", log):
        if action == "start":
            opened = float(value)
        elif opened is not None:
            out.append((opened, float(value))); opened = None
    if opened is not None:
        out.append((opened, total))
    return out


def plan(frozen, silent, protected, total_frames, fps=es.FPS):
    """Frames removable = frozen AND silent AND outside protection, rounded inward."""
    removed = set()
    for fs, fe in frozen:
        for ss, se in silent:
            lo, hi = max(fs, ss), min(fe, se)
            if hi - lo <= 0.25:
                continue
            for f in range(max(0, math.ceil(lo * fps)), min(total_frames, math.floor(hi * fps))):
                t0, t1 = f * 1000 / fps, (f + 1) * 1000 / fps
                if not any(t1 > a and t0 < b for a, b in protected):
                    removed.add(f)
    kept = [f for f in range(total_frames) if f not in removed]
    if not kept:
        raise ValueError("unsafe_render_output")
    segments = []
    for f in sorted(removed):
        if segments and segments[-1][1] == f:
            segments[-1][1] = f + 1
        else:
            segments.append([f, f + 1])
    return kept, segments


def tight_cut(path, video):
    t = video["timing"]
    total_frames = sum(t["sceneFrames"])
    total_s = t["duration_ms"] / 1000
    log = subprocess.run(["/usr/bin/ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vf", "freezedetect=n=0.004:d=0.25",
                          "-af", "silencedetect=noise=-40dB:d=0.25", "-f", "null", "-"],
                         capture_output=True, timeout=1800, check=True).stderr.decode("utf8", "replace")
    kept, removed = plan(_intervals(log, "freeze", total_s), _intervals(log, "silence", total_s), protected_ms(video), total_frames)
    info = {"before_ms": t["duration_ms"], "before_frames": total_frames,
            "removed_ms": [[round(a * 1000 / es.FPS), round(b * 1000 / es.FPS)] for a, b in removed],
            "removed_frames": total_frames - len(kept), "protected_ms": [list(p) for p in protected_ms(video)]}
    if not removed:
        info.update(after_ms=t["duration_ms"], after_frames=total_frames)
        return Path(path), info
    keep = []
    for f in kept:
        if keep and keep[-1][1] == f:
            keep[-1][1] = f + 1
        else:
            keep.append([f, f + 1])
    if len(keep) > 200:
        raise ValueError("unsafe_render_output")
    filters = []
    for i, (a, b) in enumerate(keep):
        filters += ["[0:v]trim=start_frame=%d:end_frame=%d,setpts=PTS-STARTPTS[v%d]" % (a, b, i),
                    "[0:a]atrim=start=%.9f:end=%.9f,asetpts=PTS-STARTPTS[a%d]" % (a / es.FPS, b / es.FPS, i)]
    filters.append("".join("[v%d][a%d]" % (i, i) for i in range(len(keep))) + "concat=n=%d:v=1:a=1[v][a]" % len(keep))
    out = Path(path).with_name(Path(path).stem + ".cut.mp4")
    subprocess.run(["/usr/bin/ffmpeg", "-nostdin", "-v", "error", "-n", "-i", str(path), "-filter_complex", ";".join(filters),
                    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", "30",
                    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)], check=True, capture_output=True, timeout=1800)
    info.update(after_frames=len(kept), after_ms=round(len(kept) * 1000 / es.FPS))
    return out, info


def expected(video, duration_ms):
    return {"width": video["width"], "height": video["height"], "duration_ms": duration_ms}


def validate_recipe(raw):
    """Host routing: the exam-simulator envelope goes to its pinned contract, all else to contract.py (unchanged)."""
    if targeted(raw):
        return validate(raw)
    from contract import validate_recipe as base
    return base(raw)


def validate_command(raw):
    """Wraps contract.validate_command without editing the checksum-pinned contract.py."""
    from contract import VERSION, keys, validate_command as base
    import uuid
    if isinstance(raw, dict) and raw.get("schema_version") == VERSION and isinstance(raw.get("payload"), dict):
        op, p = raw.get("operation"), raw["payload"]
        if op == "register_recipe" and targeted(p):
            keys(raw, {"schema_version", "delivery_id", "operation", "payload"}, {"schema_version", "delivery_id", "operation", "payload"})
            if str(uuid.UUID(raw["delivery_id"])) != raw["delivery_id"]:
                raise ValueError("invalid_delivery_id")
            validate(p)
            return raw
        if op == "start_series" and p.get("recipe_id") == es.RECIPE:
            raise ValueError("trial_only_recipe")
    return base(raw)
