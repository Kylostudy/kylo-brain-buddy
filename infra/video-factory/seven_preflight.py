"""One aggregate, read-only preflight; skipped checks are NOT successes.

Input root is the unpacked original seven-story inputs/ folder. No registration,
render, container launch, manager start or archive mutation happens here.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import seven_stories as seven
import seven_audio


def failure_detail(error, stage):
    """Bounded local metadata only; never export stderr, paths or exception text."""
    detail = {"stage": stage, "exception": type(error).__name__}
    if isinstance(error, subprocess.CalledProcessError):
        detail["returncode"] = error.returncode
    if isinstance(error, OSError) and error.errno is not None:
        detail["errno"] = error.errno
    if isinstance(error, ValueError) and str(error) in {
        "seven_audio_duration", "seven_alignment_invalid",
        "seven_subtitles_invalid", "seven_outro_speech_outside_outro",
        "seven_renderer_binding", "seven_renderer_digest", "renderer_review_required",
        "low_disk", "seven_legacy_self_check_failed",
    }:
        detail["reason"] = str(error)
    return detail


def checked_file(path, descriptor):
    if path.is_symlink() or not path.is_file():
        return False
    return path.stat().st_size == descriptor["bytes"] and hashlib.sha256(path.read_bytes()).hexdigest() == descriptor["sha256"]


def run(root, config=None, registered=False):
    root = Path(root)
    report = {"contract_id": seven.CONTRACT_ID, "approved_inputs_sha256": seven.contract_export()["approved_inputs_sha256"], "input_layout": "registered" if registered else "original_package", "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "stories": [], "skipped_checks": [], "errors": [], "render_started": False, "image": None}
    for story in seven.STORIES:
        row = {"story": story, "errors": [], "checked": [], "skipped_checks": []}
        spec = seven.APPROVED["stories"][story]
        originals = ("narration.mp3", "alignment.json", "timeline.json")
        paths = {original: (root / seven.template(story)["recipe_id"] / "v1" / descriptor["key"] if registered else root / story / original)
                 for original, descriptor in zip(originals, spec["files"])}
        for original, descriptor in zip(("narration.mp3", "alignment.json", "timeline.json"), spec["files"]):
            p = paths[original]
            if not checked_file(p, descriptor):
                row["errors"].append({"field": story + "/" + original, "code": "seven_media_checksum_failed"})
            else:
                row["checked"].append(original + ":sha256_ok")
        t = spec["timeline"]
        # Rounded integer boundaries are derived from frames, not independently authored.
        starts, end = [], 0
        for n in t["sceneFrames"]:
            starts.append({"start_ms": round(end * 1000 / 30), "end_ms": round((end+n) * 1000 / 30)}); end += n
        if starts != t["timing"] or round(end * 1000 / 30) != t["duration_ms"]:
            row["errors"].append({"field": story + ".sceneFrames", "code": "seven_frame_timing_mismatch"})
        audio = paths["narration.mp3"]
        if not row["errors"]:
            stage = "audio_probe"
            try:
                stream = seven_audio.probe(audio)
                row["checked"].append("audio_probe")
                stage = "full_audio_decode"
                measurement = seven_audio.decode(audio, stream)
                row["checked"].append("full_audio_decode")
                stage = "audio_duration"
                row["audio_measurement"] = seven_audio.validate_duration(measurement, t["audio_duration_seconds"], t["duration_ms"])
                seconds = measurement["samples"] / measurement["sample_rate"]
                stage = "alignment"
                alignment = json.loads(paths["alignment.json"].read_text())
                chars, a, b = [alignment[k] for k in ("characters", "character_start_times_seconds", "character_end_times_seconds")]
                if not len(chars) == len(a) == len(b) or any(not 0 <= x <= y <= seconds + .002 for x, y in zip(a, b)) or any(x > y for x, y in zip(a, a[1:])):
                    raise ValueError("seven_alignment_invalid")
                row["checked"].append("alignment")
                stage = "subtitles"
                if any(s["start_ms"] >= s["end_ms"] or s["end_ms"] > seconds * 1000 + 2 for s in t["subtitles"]):
                    raise ValueError("seven_subtitles_invalid")
                row["checked"].append("subtitles")
                stage = "outro_hold_2s"
                if t["subtitles"][-2]["start_ms"] < t["timing"][-1]["start_ms"]:
                    raise ValueError("seven_outro_speech_outside_outro")
                row["checked"] += ["sceneFrames", "full_narration_protection", "outro_hold_2s"]
            except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
                row["errors"].append({"field": story + ".audio_alignment", "code": "seven_audio_or_timing_invalid", **failure_detail(error, stage)})
        row["skipped_checks"] += [name for name in ("full_audio_decode", "alignment", "subtitles", "outro_hold_2s") if name not in row["checked"]]
        row["ok"] = not row["errors"]
        report["stories"].append(row)
    report["input_ok"] = all(s["ok"] for s in report["stories"])
    if config is None:
        report["skipped_checks"].extend(["installed_renderer_digest", "reviewed_config_match", "host_disk_space", "legacy_full_self_check"])
    else:
        stage = "reviewed_config_match"
        try:
            c = json.loads(Path(config).read_text())
            reviewed = json.loads((Path(config).parent / "reviewed-renderers.json").read_text())
            r = c["renderers"][seven.RENDERER]
            if r != reviewed.get(seven.RENDERER) or r.get("reviewed") is not True or r.get("scenes") != seven.SCENES:
                raise ValueError("seven_renderer_binding")
            import re
            if not re.fullmatch(r"sha256:[a-f0-9]{64}", r.get("image", "")):
                raise ValueError("seven_renderer_digest")
            stage = "installed_renderer_digest"
            image = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Id}}", r["image"]], timeout=30, text=True).strip()
            if image != r["image"]:
                raise ValueError("seven_renderer_digest")
            report["image"] = image
            stage = "audio_check_overlays"
            from seven_audio_runtime import audio_mounts, OVERLAYS
            audio_mounts(seven.template(seven.STORIES[0]), r)
            report["audio_check_overlays"] = {name: digest for name, (_, digest) in OVERLAYS.items()}
            stage = "host_disk_space"
            for key in ("work_root", "archive_root"):
                d = shutil.disk_usage(c[key])
                if d.free < c["min_free_bytes"] or d.used/d.total > c["max_disk_fraction"]:
                    raise ValueError("low_disk")
            from universal_runtime import self_check
            stage = "legacy_full_self_check"
            report["legacy_self_check"] = self_check(c)
            if not report["legacy_self_check"].get("ok"):
                raise ValueError("seven_legacy_self_check_failed")
        except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
            report["errors"].append({"field": "host", "code": "seven_host_check_failed", **failure_detail(error, stage)})
    report["skipped_checks"] += ["VPS_composition_frame_QA", "decoded_output_waveform", "archived_MP4_readback", "KyLogic_ack"]
    report["preparation_ok"] = report["input_ok"] and not report["errors"] and report["image"] is not None
    report["ok"] = report["preparation_ok"] and not report["skipped_checks"]
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs")
    parser.add_argument("--config")
    parser.add_argument("--registered", action="store_true")
    args = parser.parse_args()
    result = run(args.inputs, args.config, args.registered)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["input_ok"] and not result["errors"] else 1)