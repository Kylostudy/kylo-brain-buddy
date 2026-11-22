"""Independent exact-data contract for seven owner-approved Hungarian trials.

The approved MP3 and original alignment/timeline bytes are immutable inputs.
There is no source code, URL, speed control or series authority in a recipe.
"""
import copy
import hashlib
import json
from pathlib import Path

RENDERER = "seven-stories-hu-v1"
CONTRACT_ID = "kylo-seven-stories-hu-v1"
APPROVED = json.loads((Path(__file__).parent / "seven-stories-approved.json").read_text())
STORIES = tuple(APPROVED["stories"])
SCENES = ["seven-stories-%s-hu-v1" % story for story in STORIES]
SAFE = {"left": 65, "right": 950, "top": 231, "bottom": 1459}


def targeted(raw):
    return isinstance(raw, dict) and (raw.get("renderer") == RENDERER or
        str(raw.get("recipe_id", "")).startswith("seven-stories-"))


def template(story):
    spec = APPROVED["stories"][story]
    t = spec["timeline"]
    return copy.deepcopy({"schema_version": 1, "recipe_id": "seven-stories-%s-hu-trial" % story,
        "version": "v1", "renderer": RENDERER, "series": "other", "languages": ["hu"],
        "files": spec["files"], "videos": [{"video_id": story + "-hu", "language": "hu", "story": story,
            "scene": "seven-stories-%s-hu-v1" % story, "width": 1080, "height": 1920,
            "duration_ms": t["duration_ms"], "timeline": t,
            "audio": {"vo": "audio/narration-mp3", "alignment": "timing/alignment-json", "timeline": "timing/timeline-json"}}]})


def _differences(value, expected, field, errors):
    if type(value) is not type(expected):
        errors.append({"field": field, "code": "seven_type_mismatch"}); return
    if isinstance(expected, dict):
        for key in sorted(set(value) | set(expected)):
            if key not in value or key not in expected:
                errors.append({"field": field + "." + key, "code": "seven_field_mismatch"})
            else:
                _differences(value[key], expected[key], field + "." + key, errors)
    elif isinstance(expected, list):
        if len(value) != len(expected):
            errors.append({"field": field, "code": "seven_list_length"})
        for i, (a, b) in enumerate(zip(value, expected)):
            _differences(a, b, "%s[%d]" % (field, i), errors)
    elif value != expected:
        errors.append({"field": field, "code": "seven_approved_value_mismatch"})


def diagnose(raw):
    if not isinstance(raw, dict):
        return [{"field": "manifest", "code": "seven_object_required"}]
    stories = [s for s in STORIES if raw.get("recipe_id") == "seven-stories-%s-hu-trial" % s]
    if len(stories) != 1:
        return [{"field": "recipe_id", "code": "seven_unknown_story"}]
    errors = []
    _differences(raw, template(stories[0]), "manifest", errors)
    return errors


def validate(raw):
    errors = diagnose(raw)
    if errors:
        raise ValueError("seven_recipe_invalid: " + json.dumps(errors[:100]))
    return raw


def validate_request(raw):
    if not isinstance(raw, dict) or set(raw) != {"manifest", "video"}:
        raise ValueError("seven_request_invalid")
    validate(raw["manifest"])
    if raw["video"] != raw["manifest"]["videos"][0]:
        raise ValueError("seven_request_video_mismatch")
    return raw


def contract_export():
    return {"contract_id": CONTRACT_ID, "renderer": RENDERER, "scenes": SCENES,
        "approved_inputs_sha256": hashlib.sha256((Path(__file__).parent / "seven-stories-approved.json").read_bytes()).hexdigest(),
        "recipes": [template(s) for s in STORIES], "languages": ["hu"], "versions": ["v1"],
        "operations": ["register_recipe", "trial", "status", "preview", "pause", "resume", "retry"],
        "start_series": False, "concurrency": 1, "scene_frames_only": True,
        "audio_policy": {"start_ms": 0, "playback_rate": 1, "trim": False,
            "regenerate": False, "speed_filters": [], "tight_cut": False},
        "adapter": {"request": "/request.json", "inputs": "/recipe", "output": "/work/output.mp4"},
        "safe_zone": SAFE, "outro_hold_min_ms": 2000}