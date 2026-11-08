"""Shared KyLogic-VPS preflight for multilingual piggy-bank recipes (protocol v1).

Additive and inert: never registers recipes, starts TTS, renders, installs,
restarts services, writes the archive or modifies inputs. The accept decision
always comes from the installed authoritative validator (contract.validate_recipe);
the field-level diagnostics here only explain *why*, using the same imported
constants, and any disagreement between the two fails closed.

Writes (only under the dedicated preflight root, never the input/archive roots):
  <root>/state.sqlite3 (+ -wal/-shm)  durable request/result/ack/nonce store
  <root>/staging/<request_id>/...      optional quota-bounded, expiring transfer staging
"""
import copy
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
PROTOCOL = "kylo.video-factory.preflight"
PROTOCOL_VERSION = 1
PREFIX = "/api/public/video-factory/preflight/v1"
OPERATIONS = ("claim", "result", "ack")
CAPABILITY = "video_factory.preflight.v1"
CONTRACT_ID = "kylo.video-factory.piggy-i18n-recipe"
CONTRACT_VERSION = 1
VALIDATOR_FILES = ("contract.py", "piggy.py", "piggy_i18n.py")
FPS = 30
RESULT_TTL_S = 24 * 3600
STAGING_TTL_S = 24 * 3600
STAGING_QUOTA_BYTES = 2 * 1024 * 1024 * 1024
NONCE_WINDOW_S = 300
TOOL_TIMEOUT_S = 120
# Renderer-side rules (scene-frame comparison, narration bound, coin impacts) live in
# the reviewed TypeScript renderer; their reviewed sources are pinned so drift fails tests.
RENDERER_SOURCES = {
    "piggy-multilang-renderer/src/timing.ts": "8fe2206bd6bed063e7051f0a01fb9285a9fbfb3b7130ec0a3be101d5d91a6196",
    "piggy-multilang-renderer/src/index.ts": "5116e768b4ee4960292e46ce480f0be9c44c1c1adea054e73e0fe49efd80b596",
}
PIGGY_DESIGN_FRAMES = [120, 300, 120, 300, 150, 90, 90]
COIN_DESIGN_HITS = {"scene_1": [70], "scene_2": [30, 90, 150, 210]}
# Codes enforced by the reviewed renderer (not by validate_recipe); excluded from divergence detection.
RENDERER_CODES = {"piggy_scene_frames_mismatch", "piggy_audio_timing_mismatch"}
REQUEST_FIELDS = {"protocol", "protocol_version", "request_id", "owner_id", "agent_id", "recipe", "manifest",
                  "contract", "inputs", "expected_image", "requested_at"}
VIDEO_FIELDS = ({"video_id", "language", "width", "height", "duration_ms", "scene", "text", "subtitle", "cta", "audio", "master", "timing", "font"},
                {"video_id", "language", "width", "height", "duration_ms", "scene", "text", "subtitle", "cta", "audio", "master", "timing"})
TOP_FIELDS = ({"schema_version", "recipe_id", "version", "renderer", "series", "languages", "files", "videos", "continuation"},
              {"schema_version", "recipe_id", "version", "renderer", "series", "languages", "files", "videos"})


class PreflightError(ValueError):
    def __init__(self, code, path="$"):
        self.code, self.path = code, path
        super().__init__(code)


def _modules(validator_root=None):
    root = Path(validator_root or HERE).resolve()
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    import contract, piggy, piggy_i18n  # noqa: E401
    for name, module in (("contract.py", contract), ("piggy.py", piggy), ("piggy_i18n.py", piggy_i18n)):
        if Path(module.__file__).resolve().parent != root:
            raise PreflightError("preflight_validator_root_mismatch", name)
    return contract, piggy, piggy_i18n


def file_sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validator_hashes(validator_root=None):
    root = Path(validator_root or HERE)
    return {name: file_sha(root / name) for name in VALIDATOR_FILES}


def utc(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------- contract export
def contract_document(validator_root=None):
    contract, piggy, i18n = _modules(validator_root)
    doc = {
        "contract_id": CONTRACT_ID, "contract_version": CONTRACT_VERSION,
        "generated_from": {"validator_sha256": validator_hashes(validator_root), "renderer_sources_sha256": RENDERER_SOURCES},
        "renderer": i18n.RENDERER, "scene": i18n.SCENE, "series": "other", "schema_version": contract.VERSION,
        "recipes": {
            i18n.TRIAL_RECIPE: {"versions": [i18n.VERSION], "languages": [i18n.TRIAL_LANGUAGE], "videos": 1,
                                "continuation": "forbidden", "allowed_operations": ["register_recipe", "trial"],
                                "forbidden_operations": ["start_series", "series_run", "rerender"]},
            i18n.CONTINUATION_RECIPE: {"versions": [i18n.VERSION], "languages": sorted(i18n.LANGUAGES - {i18n.TRIAL_LANGUAGE}),
                                       "videos": len(i18n.LANGUAGES) - 1, "continuation": {
                                           "trial_recipe_id": i18n.TRIAL_RECIPE, "trial_version": i18n.VERSION,
                                           "completed_languages": ["en", "hu"], "hu_receipt_sha256": i18n.HU_V4_SHA256,
                                           "blocked_languages": "forbidden"},
                                       "allowed_operations": ["register_recipe", "start_series"],
                                       "requires": "owner approval from protected source bound to recipe and trial receipt"},
        },
        "languages": sorted(i18n.LANGUAGES), "rtl_languages": sorted(i18n.RTL_LANGUAGES),
        "top_level_fields": {"allowed": sorted(TOP_FIELDS[0]), "required": sorted(TOP_FIELDS[1])},
        "video": {"fields": {"allowed": sorted(VIDEO_FIELDS[0] - {"font"}), "required": sorted(VIDEO_FIELDS[1]), "forbidden": ["font"]},
                  "width": 1080, "height": 1920, "video_id": contract.ID.pattern,
                  "audio_key": i18n.audio_key("{language}"), "master_key": i18n.master_key("{language}")},
        "text": {"encoding": "JSON string", "fields": sorted(i18n.TEXT_FIELDS), "string_max": 180,
                 "steps": {"count": 4, "item_max": 100}, "labels": {"count": 5, "item_max": 100},
                 "counter_values": piggy.COUNTER, "outro_url": i18n.OUTRO_URL, "outro_tagline": i18n.OUTRO_TAGLINE,
                 "pinned_per_language": ["disclaimer", "truth", "price", "unit"], "forbidden_strings": sorted(i18n.HU_STRINGS)},
        "cta": {"encoding": "JSON string", "fields": ["supporting_text", "text", "trial_days"], "trial_days": 14,
                "text": "translations[language].cta", "supporting_text": "translations[language].supporting"},
        "translations": i18n.TRANSLATIONS,
        "timing": {"fps": FPS, "scenes": 7, "frames_per_scene": [1, 18000], "max_total_frames": 18000,
                   "source": "master file JSON {\"sceneFrames\": [7 ints]}",
                   "boundary_ms": "round(cumulative_frames * 1000 / 30)", "frame_alignment_tolerance_ms": 0.501,
                   "continuous": True, "duration_ms": "end_ms of scene 7"},
        "subtitles": {"encoding": "JSON string {\"subs\": [...]}", "fields": ["end_ms", "start_ms", "text"], "max": 2000,
                      "text_max": 180, "order": "non-overlapping, ascending", "bound": "end_ms <= timing[5].end_ms (end of scene 6)",
                      "scene_boundaries_inside": "not constrained"},
        "media": {"files": {"key": "segments " + contract.ID.pattern, "max_file_bytes": contract.MAX_FILE_BYTES,
                            "max_package_bytes": contract.MAX_PACKAGE_BYTES, "sha256": contract.SHA.pattern},
                  "required": ["audio/vo-{language}-mp3", "data/scene-frames-{language}-json", i18n.COINS_KEY],
                  "optional": [i18n.BED_KEY],
                  "narration": "ceil(duration_s * 30) <= sum(sceneFrames[0:6]); audio stream required",
                  "renderer_scene_check": "round(end_ms*30/1000) - round(start_ms*30/1000) == sceneFrames[i]",
                  "coins": {"design_frames": PIGGY_DESIGN_FRAMES, "design_hits": COIN_DESIGN_HITS,
                            "formula": "hit = offset + round(design_hit * sceneFrames[i] / design_frames[i])",
                            "sound_frames": "min(45, total_frames - hit)"}},
        "authorization": {"preflight_grants": "nothing; ready_for_approval only",
                          "trial_and_series": "owner approval verified from protected KyLogic source, bound to recipe/contract/inputs/image",
                          "owner_authorized_flag_alone": "insufficient",
                          "recipe_change": "invalidates earlier preflight results",
                          "uncertain_render_failure": "never triggers an automatic new video"},
    }
    doc["contract_sha256"] = contract.digest(doc)
    return doc


# ---------------------------------------------------------------- recipe diagnostics
def _issue(issues, path, code, **extra):
    issues.append({"path": path, "code": code, **extra})


def _json_field(issues, skipped, path, value, fields):
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        _issue(issues, path, "piggy_invalid_json")
        skipped.append({"check": path + ".*", "reason": "invalid_json"})
        return None
    if not isinstance(parsed, dict):
        _issue(issues, path, "piggy_unsupported_fields", hint="object required")
        skipped.append({"check": path + ".*", "reason": "not_an_object"})
        return None
    missing, extra = sorted(set(fields) - set(parsed)), sorted(set(parsed) - set(fields))
    if missing or extra:
        _issue(issues, path, "piggy_unsupported_fields", missing=missing, unexpected=extra)
    return parsed


def boundaries(scene_frames):
    out, cum = [0], 0
    for n in scene_frames:
        cum += n
        out.append(round(cum * 1000 / FPS))
    return out


def coin_hits(scene_frames):
    s = lambda i, f: round(f * scene_frames[i] / PIGGY_DESIGN_FRAMES[i])  # noqa: E731
    return [s(0, 70)] + [scene_frames[0] + s(1, h) for h in (30, 90, 150, 210)]


def diagnose_recipe(recipe, scene_frames_by_language=None, validator_root=None):
    """Return (issues, skipped). Independent field checks run even when siblings fail;
    checks that depend on a broken structure are listed as skipped, never guessed."""
    contract, piggy, i18n = _modules(validator_root)
    issues, skipped = [], []
    frames_by_lang = scene_frames_by_language or {}
    if not isinstance(recipe, dict):
        _issue(issues, "$", "unsupported_fields")
        return issues, [{"check": "$.*", "reason": "not_an_object"}]
    missing, extra = sorted(TOP_FIELDS[1] - set(recipe)), sorted(set(recipe) - TOP_FIELDS[0])
    if missing or extra:
        _issue(issues, "$", "unsupported_fields", missing=missing, unexpected=extra)
    for key, want, code in (("schema_version", 1, "piggy_i18n_unknown_recipe"), ("renderer", i18n.RENDERER, "piggy_i18n_unknown_recipe"),
                            ("series", "other", "piggy_i18n_unknown_recipe"), ("version", i18n.VERSION, "piggy_i18n_single_en_trial_only")):
        if recipe.get(key) != want:
            _issue(issues, "$." + key, code, expected=want)
    rid = recipe.get("recipe_id")
    if rid == i18n.TRIAL_RECIPE:
        if recipe.get("languages") != [i18n.TRIAL_LANGUAGE]:
            _issue(issues, "$.languages", "piggy_i18n_single_en_trial_only", expected=[i18n.TRIAL_LANGUAGE])
        if "continuation" in recipe:
            _issue(issues, "$.continuation", "piggy_i18n_single_en_trial_only", hint="must be absent")
        if not isinstance(recipe.get("videos"), list) or len(recipe["videos"]) != 1:
            _issue(issues, "$.videos", "piggy_i18n_single_en_trial_only", expected_count=1)
    elif rid == i18n.CONTINUATION_RECIPE:
        skipped.append({"check": "$.continuation", "reason": "continuation anchor is verified by the authoritative validator only"})
    else:
        _issue(issues, "$.recipe_id", "piggy_i18n_unknown_recipe", expected=[i18n.TRIAL_RECIPE, i18n.CONTINUATION_RECIPE])
        return issues, skipped + [{"check": "$.videos", "reason": "unknown_recipe"}]
    names = set()
    files = recipe.get("files")
    if not isinstance(files, list) or not files:
        _issue(issues, "$.files", "invalid_file_list")
    else:
        for i, f in enumerate(files):
            p = "$.files[%d]" % i
            if not isinstance(f, dict) or set(f) != {"key", "bytes", "sha256"}:
                _issue(issues, p, "unsupported_fields", expected=["bytes", "key", "sha256"])
                continue
            try:
                contract.object_key(f["key"])
            except ValueError:
                _issue(issues, p + ".key", "invalid_object_key")
                continue
            if f["key"] in names:
                _issue(issues, p + ".key", "invalid_file", hint="duplicate key")
            if type(f["bytes"]) is not int or not 1 <= f["bytes"] <= contract.MAX_FILE_BYTES:
                _issue(issues, p + ".bytes", "invalid_file", expected_range=[1, contract.MAX_FILE_BYTES])
            if not isinstance(f["sha256"], str) or not contract.SHA.fullmatch(f["sha256"]):
                _issue(issues, p + ".sha256", "invalid_checksum")
            names.add(f["key"])
    languages = recipe.get("languages") if isinstance(recipe.get("languages"), list) else []
    allowed = {i18n.audio_key(l) for l in languages} | {i18n.master_key(l) for l in languages} | {i18n.COINS_KEY, i18n.BED_KEY}
    for key in sorted(names - allowed):
        _issue(issues, "$.files", "piggy_i18n_invalid_input_list", unexpected=key)
    if i18n.COINS_KEY not in names:
        _issue(issues, "$.files", "piggy_i18n_invalid_input_list", missing=i18n.COINS_KEY)
    for i, v in enumerate(recipe.get("videos") or []):
        _diagnose_video(issues, skipped, "$.videos[%d]" % i, v, names, frames_by_lang, contract, piggy, i18n)
    return issues, skipped


def _diagnose_video(issues, skipped, p, v, names, frames_by_lang, contract, piggy, i18n):
    if not isinstance(v, dict):
        _issue(issues, p, "unsupported_fields")
        skipped.append({"check": p + ".*", "reason": "not_an_object"})
        return
    missing, extra = sorted(VIDEO_FIELDS[1] - set(v)), sorted(set(v) - VIDEO_FIELDS[0])
    if missing or extra or "font" in v:
        _issue(issues, p, "unsupported_fields" if missing or extra else "piggy_i18n_invalid_scene", missing=missing,
               unexpected=extra + (["font"] if "font" in v else []))
    lang = v.get("language")
    if lang not in i18n.LANGUAGES:
        _issue(issues, p + ".language", "piggy_i18n_invalid_scene", expected=sorted(i18n.LANGUAGES))
        skipped.append({"check": p + ".text/cta", "reason": "unknown_language"})
        return
    fixed = i18n.TRANSLATIONS[lang]
    if v.get("scene") != i18n.SCENE:
        _issue(issues, p + ".scene", "piggy_i18n_invalid_scene", expected=i18n.SCENE)
    for key, want in (("width", 1080), ("height", 1920)):
        if v.get(key) != want:
            _issue(issues, p + "." + key, "piggy_i18n_invalid_scene", expected=want)
    try:
        contract.identifier(v.get("video_id"))
    except ValueError:
        _issue(issues, p + ".video_id", "invalid_identifier")
    text = _json_field(issues, skipped, p + ".text", v.get("text"), i18n.TEXT_FIELDS)
    if text is not None:
        for key in ("heading",):
            if key in text and (not isinstance(text[key], str) or not text[key].strip() or len(text[key]) > 180):
                _issue(issues, "%s.text.%s" % (p, key), "piggy_invalid_text", max_length=180)
        for key in ("disclaimer", "truth", "price", "unit"):
            if key in text and text[key] != fixed[key]:
                _issue(issues, "%s.text.%s" % (p, key), "piggy_i18n_translation_required", expected=fixed[key])
            elif key not in text:
                _issue(issues, "%s.text.%s" % (p, key), "piggy_unsupported_fields", hint="missing", expected=fixed[key])
        for key, want in (("outro_url", i18n.OUTRO_URL), ("outro_tagline", i18n.OUTRO_TAGLINE)):
            if key in text and text[key] != want:
                _issue(issues, "%s.text.%s" % (p, key), "piggy_i18n_brand_immutable", expected=want)
        if "counter_values" in text and text["counter_values"] != piggy.COUNTER:
            _issue(issues, p + ".text.counter_values", "piggy_invalid_offer", expected=piggy.COUNTER)
        for key, count in (("steps", 4), ("labels", 5)):
            if key in text and (not isinstance(text[key], list) or len(text[key]) != count or any(
                    not isinstance(s, str) or not s.strip() or len(s) > 100 for s in text[key])):
                _issue(issues, "%s.text.%s" % (p, key), "piggy_invalid_text", expected_count=count, item_max=100)
        for key in ("heading", "disclaimer", "truth", "price", "unit"):
            if text.get(key) in i18n.HU_STRINGS:
                _issue(issues, "%s.text.%s" % (p, key), "piggy_i18n_hungarian_text")
    want_cta = {"text": fixed["cta"], "supporting_text": fixed["supporting"], "trial_days": 14}
    cta = _json_field(issues, skipped, p + ".cta", v.get("cta"), want_cta)
    if cta is not None:
        for key, want in want_cta.items():
            if key in cta and cta[key] != want:
                _issue(issues, "%s.cta.%s" % (p, key), "piggy_i18n_invalid_cta", expected=want)
    for key, want in (("audio", i18n.audio_key(lang)), ("master", i18n.master_key(lang))):
        if v.get(key) != want:
            _issue(issues, p + "." + key, "piggy_i18n_invalid_media", expected=want)
        elif want not in names:
            _issue(issues, p + "." + key, "piggy_i18n_invalid_input_list", missing=want)
    timing_ok = _diagnose_timing(issues, p, v, frames_by_lang.get(lang), piggy)
    if not timing_ok:
        skipped.append({"check": p + ".subtitle", "reason": "timing_invalid: subtitle bound depends on timing[5].end_ms"})
        return
    subs = _json_field(issues, skipped, p + ".subtitle", v.get("subtitle"), {"subs"})
    if subs is None or "subs" not in subs:
        return
    items, last, bound = subs["subs"], 0, v["timing"][5]["end_ms"]
    if not isinstance(items, list) or len(items) > 2000:
        _issue(issues, p + ".subtitle.subs", "piggy_invalid_subtitles", max_items=2000)
        return
    for k, s in enumerate(items):
        sp = "%s.subtitle.subs[%d]" % (p, k)
        if not isinstance(s, dict) or set(s) != {"start_ms", "end_ms", "text"} or type(s.get("start_ms")) is not int or type(s.get("end_ms")) is not int:
            _issue(issues, sp, "piggy_invalid_subtitles", expected_fields=["end_ms", "start_ms", "text"])
            skipped.append({"check": "%s.subtitle.subs[%d:]" % (p, k + 1), "reason": "order depends on previous item"})
            return
        if not last <= s["start_ms"] < s["end_ms"] <= bound:
            _issue(issues, sp, "piggy_invalid_subtitles", previous_end_ms=last, max_end_ms=bound)
        if not isinstance(s["text"], str) or not s["text"].strip() or len(s["text"]) > 180:
            _issue(issues, sp + ".text", "piggy_invalid_subtitles", max_length=180)
        elif any(hu in s["text"] for hu in i18n.HU_STRINGS):
            _issue(issues, sp + ".text", "piggy_i18n_hungarian_text")
        last = s["end_ms"]


def _diagnose_timing(issues, p, v, scene_frames, piggy):
    timing, ok = v.get("timing"), True
    expected = boundaries(scene_frames) if scene_frames else None
    if not isinstance(timing, list) or len(timing) != 7:
        _issue(issues, p + ".timing", "piggy_invalid_scene_frames", expected_count=7,
               **({"expected_boundaries_ms": expected} if expected else {}))
        return False
    end = 0
    for k, t in enumerate(timing):
        tp = "%s.timing[%d]" % (p, k)
        if not isinstance(t, dict) or set(t) != {"start_ms", "end_ms"} or type(t.get("start_ms")) is not int or type(t.get("end_ms")) is not int:
            _issue(issues, tp, "piggy_invalid_timing", expected_fields=["end_ms", "start_ms"])
            return False
        if t["start_ms"] != end:
            _issue(issues, tp + ".start_ms", "piggy_invalid_timing", expected=end, hint="continuous")
            ok = False
        for side in ("start_ms", "end_ms"):
            ms = t[side]
            if abs(ms - round(ms * FPS / 1000) * 1000 / FPS) > 0.501 and not (side == "start_ms" and k > 0):
                extra = {"expected": expected[k + (1 if side == "end_ms" else 0)]} if expected else {"hint": "nearest-ms of an exact 30fps frame"}
                _issue(issues, "%s.%s" % (tp, side), "piggy_invalid_timing", **extra)
                ok = False
            elif expected and ms != expected[k + (1 if side == "end_ms" else 0)] and not (side == "start_ms" and k > 0):
                _issue(issues, "%s.%s" % (tp, side), "piggy_scene_frames_mismatch", expected=expected[k + (1 if side == "end_ms" else 0)],
                       hint="must match cumulative sceneFrames")
                ok = False
        end = t["end_ms"]
    if v.get("duration_ms") != end:
        _issue(issues, p + ".duration_ms", "piggy_invalid_timing", expected=expected[-1] if expected else end)
        ok = False
    elif expected and end != expected[-1]:
        _issue(issues, p + ".duration_ms", "piggy_scene_frames_mismatch", expected=expected[-1])
        ok = False
    if ok:
        frames = [round(t["end_ms"] * FPS / 1000) - round(t["start_ms"] * FPS / 1000) for t in timing]
        try:
            piggy.scene_frames(frames)
        except ValueError as exc:
            _issue(issues, p + ".timing", str(exc))
            ok = False
    return ok


def check_recipe(recipe, scene_frames_by_language=None, validator_root=None):
    contract, _, _ = _modules(validator_root)
    issues, skipped = diagnose_recipe(recipe, scene_frames_by_language, validator_root)
    try:
        contract.validate_recipe(copy.deepcopy(recipe))
        authoritative = "accepted"
    except Exception as exc:  # authoritative code only, never free text
        authoritative = str(exc) if isinstance(exc, ValueError) and str(exc).replace("_", "").isalnum() else "validator_error"
    if authoritative != "accepted" and not issues:
        _issue(issues, "$", authoritative, hint="authoritative_validator_rejected")
    if authoritative == "accepted" and any(i["code"] not in RENDERER_CODES for i in issues):
        # Fail closed: a diagnostic the authoritative validator does not share is a rule divergence.
        _issue(issues, "$", "preflight_rule_divergence")
    status = "pass" if authoritative == "accepted" and not issues else "fail"
    return {"status": status, "authoritative": authoritative, "issues": issues, "skipped": skipped}


# ---------------------------------------------------------------- staging & media
def staged_fd(staging_root, request_id, key, contract):
    """Open a staged input read-only without following symlinks at any depth."""
    contract.object_key(key)
    if str(uuid.UUID(request_id)) != request_id:
        raise PreflightError("preflight_invalid_request_id")
    fd = os.open(str(staging_root), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in [request_id] + key.split("/")[:-1]:
            nfd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nfd
        leaf = os.open(key.split("/")[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
    finally:
        os.close(fd)
    if not stat.S_ISREG(os.fstat(leaf).st_mode):
        os.close(leaf)
        raise PreflightError("preflight_not_regular_file")
    return leaf


def _tool(args, runner):
    return runner(args, capture_output=True, text=True, timeout=TOOL_TIMEOUT_S, check=False)


def check_media(manifest, staging_root, request_id, runner=subprocess.run, validator_root=None):
    contract, piggy, i18n = _modules(validator_root)
    issues, skipped, facts, frames_by_lang = [], [], {}, {}
    present = {}
    for i, f in enumerate(manifest.get("files", [])):
        p = "$.files[%d]" % i
        try:
            fd = staged_fd(staging_root, request_id, f["key"], contract)
        except FileNotFoundError:
            skipped.append({"check": p, "reason": "input_not_staged"})
            continue
        except (OSError, PreflightError) as exc:
            _issue(issues, p + ".key", getattr(exc, "code", "preflight_unsafe_path"))
            continue
        with os.fdopen(fd, "rb") as handle:
            size, h = 0, hashlib.sha256()
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                size += len(chunk)
                h.update(chunk)
        if size != f["bytes"]:
            _issue(issues, p + ".bytes", "preflight_input_size_mismatch", expected=f["bytes"], actual=size)
        if h.hexdigest() != f["sha256"]:
            _issue(issues, p + ".sha256", "preflight_input_checksum_mismatch")
        if size == f["bytes"] and h.hexdigest() == f["sha256"]:
            present[f["key"]] = True
    for v in manifest.get("videos", []):
        lang, vp = v.get("language"), "$.videos[%d]" % manifest["videos"].index(v)
        master = v.get("master")
        if not present.get(master):
            skipped.append({"check": vp + ".master", "reason": "master_unverified"})
        else:
            with os.fdopen(staged_fd(staging_root, request_id, master, contract), "rb") as handle:
                try:
                    data = json.loads(handle.read(64 * 1024))
                    frames = piggy.scene_frames(data["sceneFrames"]) if isinstance(data, dict) and set(data) == {"sceneFrames"} else None
                except (ValueError, KeyError):
                    frames = None
            if frames is None:
                _issue(issues, vp + ".master", "piggy_invalid_scene_frames")
            else:
                frames_by_lang[lang] = frames
                facts[lang] = {"scene_frames": frames, "boundaries_ms": boundaries(frames), "total_frames": sum(frames),
                               "coin_hit_frames": coin_hits(frames)}
                timing = v.get("timing")
                if isinstance(timing, list) and all(isinstance(t, dict) and type(t.get("start_ms")) is int and type(t.get("end_ms")) is int for t in timing):
                    derived = [round(t["end_ms"] * FPS / 1000) - round(t["start_ms"] * FPS / 1000) for t in timing]
                    if derived != frames:
                        _issue(issues, vp + ".timing", "piggy_scene_frames_mismatch", expected_frames=frames, actual_frames=derived)
                else:
                    skipped.append({"check": vp + ".timing~sceneFrames", "reason": "timing_invalid"})
        for key, role in ((v.get("audio"), "narration"), (i18n.COINS_KEY, "coins")):
            if not present.get(key):
                skipped.append({"check": "%s.%s" % (vp, role), "reason": "input_unverified"})
                continue
            if not shutil.which("ffprobe") or not shutil.which("ffmpeg"):
                skipped.append({"check": "%s.%s" % (vp, role), "reason": "ffprobe_unavailable"})
                continue
            path = str(Path(staging_root) / request_id / key)  # already proven non-symlink regular file
            probe = _tool(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", path], runner)
            decode = _tool(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", path, "-f", "null", "-"], runner)
            try:
                info = json.loads(probe.stdout) if probe.returncode == 0 else None
                duration = float(info["format"]["duration"]) if info else math.nan
                has_audio = bool(info) and any(s.get("codec_type") == "audio" for s in info.get("streams", []))
            except (ValueError, KeyError, TypeError):
                duration, has_audio = math.nan, False
            if decode.returncode != 0 or decode.stderr.strip() or not has_audio or not math.isfinite(duration):
                _issue(issues, "%s.%s" % (vp, role), "preflight_media_undecodable")
                continue
            facts.setdefault(lang, {})["%s_duration_ms" % role] = round(duration * 1000)
            if role == "narration":
                if lang not in frames_by_lang:
                    skipped.append({"check": vp + ".narration_length", "reason": "scene_frames_unverified"})
                else:
                    limit = sum(frames_by_lang[lang][:6])
                    if math.ceil(duration * FPS) > limit:
                        _issue(issues, vp + ".narration", "piggy_audio_timing_mismatch", max_frames=limit,
                               actual_frames=math.ceil(duration * FPS))
    complete = not any(s["reason"] in {"input_not_staged", "input_unverified", "master_unverified", "ffprobe_unavailable",
                                         "scene_frames_unverified"} for s in skipped)
    status = "fail" if issues else ("pass" if complete else "incomplete")
    return {"status": status, "issues": issues, "skipped": skipped, "facts": facts}, frames_by_lang


def check_renderer(expected_image, config_path, reviewed_path, inspect):
    issues = []
    try:
        name = "piggy-bank-multilang-safe-v1"
        configured = json.loads(Path(config_path).read_text()).get("renderers", {}).get(name, {})
        reviewed = json.loads(Path(reviewed_path).read_text()).get(name, {})
    except (OSError, ValueError):
        return {"status": "skipped", "issues": [], "skipped": [{"check": "renderer", "reason": "config_unreadable"}]}, None
    image = configured.get("image")
    if image != reviewed.get("image") or configured.get("reviewed") is not True or configured.get("scenes") != ["piggy-bank-i18n-v1"]:
        _issue(issues, "renderer", "preflight_renderer_not_reviewed")
    actual = inspect(image) if isinstance(image, str) and image.startswith("sha256:") else None
    if not actual:
        _issue(issues, "renderer", "image_unavailable")
    elif actual != expected_image:
        _issue(issues, "$.expected_image", "preflight_image_mismatch", actual=actual)
    return {"status": "fail" if issues else "pass", "issues": issues, "skipped": []}, actual


def docker_inspect(image):
    r = subprocess.run(["/usr/bin/docker", "image", "inspect", "--format", "{{.Id}}", image],
                       capture_output=True, text=True, timeout=30, check=False)
    out = r.stdout.strip()
    return out if r.returncode == 0 and out.startswith("sha256:") else None


# ---------------------------------------------------------------- request & result
def validate_request(req, validator_root=None):
    contract, _, i18n = _modules(validator_root)
    if not isinstance(req, dict) or set(req) != REQUEST_FIELDS:
        raise PreflightError("preflight_unsupported_fields")
    if req["protocol"] != PROTOCOL or req["protocol_version"] != PROTOCOL_VERSION:
        raise PreflightError("preflight_protocol_unsupported", "$.protocol")
    if str(uuid.UUID(str(req["request_id"]))) != req["request_id"]:
        raise PreflightError("preflight_invalid_request_id", "$.request_id")
    for key in ("owner_id", "agent_id"):
        try:
            contract.identifier(req[key])
        except ValueError:
            raise PreflightError("preflight_invalid_identity", "$." + key) from None
    c = req["contract"]
    if not isinstance(c, dict) or set(c) != {"id", "version", "sha256"}:
        raise PreflightError("preflight_unsupported_fields", "$.contract")
    if c["id"] != CONTRACT_ID or c["version"] != CONTRACT_VERSION:
        raise PreflightError("preflight_contract_unknown", "$.contract")
    if c["sha256"] != contract_document(validator_root)["contract_sha256"]:
        raise PreflightError("preflight_contract_mismatch", "$.contract.sha256")
    r, manifest = req["recipe"], req["manifest"]
    if not isinstance(r, dict) or set(r) != {"recipe_id", "version", "sha256"} or not isinstance(manifest, dict):
        raise PreflightError("preflight_unsupported_fields", "$.recipe")
    if r["recipe_id"] not in {i18n.TRIAL_RECIPE, i18n.CONTINUATION_RECIPE}:
        raise PreflightError("preflight_recipe_not_allowed", "$.recipe.recipe_id")
    if (manifest.get("recipe_id"), manifest.get("version")) != (r["recipe_id"], r["version"]):
        raise PreflightError("preflight_recipe_identity_mismatch", "$.recipe")
    if contract.digest(manifest) != r["sha256"]:
        raise PreflightError("preflight_recipe_hash_mismatch", "$.recipe.sha256")
    key = lambda f: f.get("key", "") if isinstance(f, dict) else ""  # noqa: E731
    if not isinstance(req["inputs"], list) or sorted(req["inputs"], key=key) != sorted(manifest.get("files") or [], key=key):
        raise PreflightError("preflight_input_binding_mismatch", "$.inputs")
    if not isinstance(req["expected_image"], str) or not req["expected_image"].startswith("sha256:") or not contract.SHA.fullmatch(req["expected_image"][7:]):
        raise PreflightError("preflight_invalid_image", "$.expected_image")
    if type(req["requested_at"]) is not int:
        raise PreflightError("preflight_invalid_time", "$.requested_at")
    return req


SIDE_EFFECTS = {"recipe_registered": False, "tts_started": False, "render_started": False, "installed_or_restarted": False,
                "archive_written": False, "inputs_modified": False}


def run_check(req, staging_root, config_path, reviewed_path, now=None, inspect=docker_inspect, runner=subprocess.run, validator_root=None):
    contract, _, _ = _modules(validator_root)
    validate_request(req, validator_root)
    now = int(time.time()) if now is None else now
    media, frames = check_media(req["manifest"], staging_root, req["request_id"], runner, validator_root)
    recipe = check_recipe(req["manifest"], frames, validator_root)
    renderer, actual_image = check_renderer(req["expected_image"], config_path, reviewed_path, inspect)
    ready = recipe["status"] == "pass" and media["status"] == "pass" and renderer["status"] == "pass"
    result = {
        "protocol": PROTOCOL, "protocol_version": PROTOCOL_VERSION, "request_id": req["request_id"],
        "owner_id": req["owner_id"], "agent_id": req["agent_id"], "request_sha256": contract.digest(req),
        "recipe": req["recipe"], "contract": req["contract"], "inputs": sorted(req["inputs"], key=lambda f: f["key"]),
        "expected_image": req["expected_image"],
        "actual": {"image": actual_image, "validator_sha256": validator_hashes(validator_root),
                   "contract_sha256": contract_document(validator_root)["contract_sha256"], "capability": CAPABILITY},
        "checked_at": utc(now), "expires_at": utc(now + RESULT_TTL_S),
        "status": "ready_for_approval" if ready else "blocked",
        "recipe_check": recipe, "media_check": media, "renderer_check": renderer,
        "authorization": "not_granted", "side_effects": dict(SIDE_EFFECTS),
    }
    result["result_sha256"] = contract.digest(result)
    return result


def normalized(result):
    """Location-independent view used to compare local and VPS outcomes."""
    keep = {k: result[k] for k in ("status", "recipe", "contract", "inputs", "expected_image", "authorization", "side_effects")}
    keep["recipe_check"] = result["recipe_check"]
    keep["media_check"] = {"status": result["media_check"]["status"], "issues": result["media_check"]["issues"]}
    return keep


# ---------------------------------------------------------------- durable store
class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = str(self.root / "state.sqlite3")
        with self._db() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS preflight(request_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, request_sha256 TEXT NOT NULL,
                result TEXT NOT NULL, result_sha256 TEXT NOT NULL, checked_at INTEGER NOT NULL, acked_at INTEGER);
            CREATE TABLE IF NOT EXISTS nonces(nonce TEXT PRIMARY KEY, seen_at INTEGER NOT NULL);
            """)

    def _db(self):
        db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        return _Tx(db)

    def check(self, req, make_result):
        """Same id + same canonical payload + same agent -> stored result (original checked_at).
        Same id with any difference -> stable conflict. Result is durable before it is returned."""
        from contract import digest
        identity = digest(req)
        with self._db() as db:
            row = db.execute("SELECT agent_id, request_sha256, result FROM preflight WHERE request_id=?", (req["request_id"],)).fetchone()
            if row:
                if row[0] != req["agent_id"] or row[1] != identity:
                    raise PreflightError("preflight_request_conflict", "$.request_id")
                return json.loads(row[2])
        result = make_result()
        from contract import canonical
        with self._db() as db:
            row = db.execute("SELECT request_sha256, result FROM preflight WHERE request_id=?", (req["request_id"],)).fetchone()
            if row:
                if row[0] != identity:
                    raise PreflightError("preflight_request_conflict", "$.request_id")
                return json.loads(row[1])
            db.execute("INSERT INTO preflight VALUES(?,?,?,?,?,?,NULL)", (req["request_id"], req["agent_id"], identity,
                       canonical(result).decode(), result["result_sha256"], int(time.time())))
        return result

    def ack(self, request_id, agent_id, result_sha256, now=None):
        with self._db() as db:
            row = db.execute("SELECT agent_id, result_sha256, acked_at FROM preflight WHERE request_id=?", (request_id,)).fetchone()
            if not row:
                raise PreflightError("preflight_ack_unknown")
            if row[0] != agent_id or row[1] != result_sha256:
                raise PreflightError("preflight_ack_mismatch")
            if row[2] is None:
                db.execute("UPDATE preflight SET acked_at=? WHERE request_id=?", (int(time.time()) if now is None else now, request_id))
            return True

    def pending_results(self):
        with self._db() as db:
            return [json.loads(r[0]) for r in db.execute("SELECT result FROM preflight WHERE acked_at IS NULL ORDER BY checked_at")]

    def accept_nonce(self, nonce, timestamp, now=None):
        now = int(time.time()) if now is None else now
        if abs(now - timestamp) > NONCE_WINDOW_S:
            raise PreflightError("preflight_stale_signature")
        with self._db() as db:
            db.execute("DELETE FROM nonces WHERE seen_at < ?", (now - 2 * NONCE_WINDOW_S,))
            try:
                db.execute("INSERT INTO nonces VALUES(?,?)", (nonce, now))
            except sqlite3.IntegrityError:
                raise PreflightError("preflight_nonce_replay") from None
        return True

    # Staging: dedicated, quota-bounded, expiring; never the recipe/input/archive roots.
    def staging_root(self):
        path = self.root / "staging"
        path.mkdir(mode=0o700, exist_ok=True)
        return path

    def reserve_staging(self, request_id, total_bytes):
        from contract import MAX_PACKAGE_BYTES
        if str(uuid.UUID(request_id)) != request_id:
            raise PreflightError("preflight_invalid_request_id")
        if total_bytes > MAX_PACKAGE_BYTES or self._staged_bytes() + total_bytes > STAGING_QUOTA_BYTES:
            raise PreflightError("preflight_staging_quota")
        target = self.staging_root() / request_id
        target.mkdir(mode=0o700, exist_ok=False)
        return target

    def _staged_bytes(self):
        total = 0
        for dirpath, _, files in os.walk(self.staging_root(), followlinks=False):
            total += sum(os.lstat(os.path.join(dirpath, f)).st_size for f in files)
        return total

    def purge_staging(self, now=None):
        now = time.time() if now is None else now
        removed = []
        for entry in os.scandir(self.staging_root()):
            if entry.is_dir(follow_symlinks=False) and now - entry.stat(follow_symlinks=False).st_mtime > STAGING_TTL_S:
                shutil.rmtree(entry.path)
                removed.append(entry.name)
            elif entry.is_symlink():
                os.unlink(entry.path)
        return removed


class _Tx:
    def __init__(self, db):
        self.db = db

    def __enter__(self):
        self.db.execute("BEGIN IMMEDIATE")
        return self.db

    def __exit__(self, kind, *_):
        self.db.execute("ROLLBACK" if kind else "COMMIT")
        self.db.close()


# ---------------------------------------------------------------- signing & production gate
def sign(secret, timestamp, nonce, method, operation, body):
    if operation not in OPERATIONS:
        raise PreflightError("preflight_operation_not_allowed")
    from client import signature
    return signature(secret, timestamp, nonce, method, PREFIX + "/" + operation, body)


def verify_signature(secret, store, headers, method, operation, body, now=None):
    stamp, nonce = headers.get("X-Factory-Timestamp", ""), headers.get("X-Factory-Nonce", "")
    if not stamp.isdigit():
        raise PreflightError("preflight_stale_signature")
    expected = sign(secret, stamp, nonce, method, operation, body)
    if not hmac.compare_digest(expected, headers.get("X-Factory-Signature", "")):
        raise PreflightError("preflight_signature_invalid")
    return store.accept_nonce(nonce, int(stamp), now)


def production_gate(operation, result, current, approval_verified, now=None):
    """Proposal for the pre-trial/series re-check (not wired into state.py yet).
    `current` = freshly recomputed bindings; `approval_verified` = result of the
    protected-source owner check (never a submitted owner_authorized flag)."""
    from piggy_i18n import TRIAL_RECIPE
    now = int(time.time()) if now is None else now
    if operation not in {"trial", "start_series"}:
        raise PreflightError("preflight_operation_not_gated")
    if operation == "start_series" and result["recipe"]["recipe_id"] == TRIAL_RECIPE:
        raise PreflightError("trial_only_recipe")
    if result.get("status") != "ready_for_approval":
        raise PreflightError("preflight_not_ready")
    if datetime.fromisoformat(result["expires_at"].replace("Z", "+00:00")).timestamp() <= now:
        raise PreflightError("preflight_result_expired")
    for key, actual in (("recipe", current["recipe"]), ("contract", current["contract"]), ("inputs", current["inputs"])):
        if result[key] != actual:
            raise PreflightError("preflight_binding_changed", "$." + key)
    if result["actual"]["image"] != current["image"] or result["actual"]["validator_sha256"] != current["validator_sha256"]:
        raise PreflightError("preflight_binding_changed", "$.actual")
    if approval_verified is not True:
        raise PreflightError("owner_approval_required")
    return True


def main(argv):
    if argv[1:2] == ["export-contract"]:
        print(json.dumps(contract_document(), indent=2, ensure_ascii=False, sort_keys=True))
        return 0
    if argv[1:2] == ["check"] and len(argv) == 3:
        # One-shot, offline. Reads the request, staging and renderer config; writes only the preflight store.
        req = json.loads(Path(argv[2]).read_text())
        store = Store(os.environ.get("KYLO_PREFLIGHT_ROOT", "/var/lib/kylo-video-factory/preflight"))
        try:
            result = store.check(req, lambda: run_check(req, store.staging_root(), "/etc/kylo-video-factory/config.json",
                                                        "/etc/kylo-video-factory/reviewed-renderers.json"))
        except PreflightError as exc:
            print(json.dumps({"ok": False, "code": exc.code, "path": exc.path}))
            return 1
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0 if result["status"] == "ready_for_approval" else 1
    print("usage: preflight.py export-contract | check <request.json>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
