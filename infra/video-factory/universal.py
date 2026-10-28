"""Version-two data contract and bounded QA helpers. Legacy contracts stay intact."""
import json
import math
import re
from contract import identifier, object_key, keys, canonical, SHA, MAX_MANIFEST_BYTES, MAX_FILE_BYTES, MAX_PACKAGE_BYTES

RENDERER = "exam-promo-universal-v1"
SAFE_ZONE = {"left": 65, "right": 950, "top": 231, "bottom": 1459}
LANGUAGES = "en de nl fr ja es pt it ko pl no sv cs tr sk sl da fi ar hi sr ru ro hr el hu zh".split()
SCENES = ("pressure", "dry_answer", "understanding", "questions", "simulation", "feedback", "cta", "outro")
OPERATIONS = {"register_recipe", "preview", "trial", "series_run", "rerender", "retry", "pause", "resume", "cancel", "status", "inventory", "logs", "qa_fetch"}


class FactoryError(ValueError):
    def __init__(self, stage, code, message, **context):
        super().__init__(message)
        self.result = {"stage": stage, "code": code, "message": message, "log_tail": [], **context}


def require(value, allowed, required, field):
    if not isinstance(value, dict):
        raise FactoryError("recipe_schema", "invalid_field", field + ": object required", field=field)
    for name in required:
        if name not in value:
            raise FactoryError("recipe_schema", "missing_field", field + "." + name + ": required", field=field + "." + name)
    if set(value) - set(allowed):
        name = sorted(set(value) - set(allowed))[0]
        raise FactoryError("recipe_schema", "unsupported_field", field + "." + name, field=field + "." + name)


def number(value, field, minimum=0, maximum=3600000):
    if type(value) not in (int, float) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise FactoryError("recipe_schema", "invalid_number", field, field=field)


def rectangle(rect, field, zone=False):
    require(rect, SAFE_ZONE, SAFE_ZONE, field)
    for k, v in rect.items():
        number(v, field + "." + k, 0, 1920 if k in ("top", "bottom") else 1080)
    if rect["left"] >= rect["right"] or rect["top"] >= rect["bottom"]:
        raise FactoryError("recipe_schema", "invalid_rectangle", field)


def text(value, field, limit=5000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise FactoryError("recipe_schema", "invalid_text", field, field=field)


def validate(raw):
    fields = {"schema_version", "recipe_id", "version", "renderer", "exam", "safe_zone", "languages", "files", "videos", "completed"}
    require(raw, fields, fields - {"completed"}, "recipe")
    if raw["schema_version"] != 2 or raw["renderer"] != RENDERER or len(canonical(raw)) > MAX_MANIFEST_BYTES:
        raise FactoryError("recipe_schema", "invalid_manifest", "schema_version/renderer/size")
    identifier(raw["recipe_id"]); identifier(raw["version"])
    rectangle(raw["safe_zone"], "safe_zone")
    exam = raw["exam"]
    require(exam, {"name", "sections", "score_scale", "sample_percent", "vocabulary", "skin"}, {"name", "sections", "score_scale", "sample_percent", "vocabulary", "skin"}, "exam")
    text(exam["name"], "exam.name", 200)
    number(exam["sample_percent"], "exam.sample_percent", 0, 100)
    text(exam["score_scale"], "exam.score_scale", 200)
    if not isinstance(exam["sections"], list) or not 1 <= len(exam["sections"]) <= 12:
        raise FactoryError("recipe_schema", "invalid_sections", "exam.sections")
    for i, item in enumerate(exam["sections"]):
        require(item, {"name", "time", "example"}, {"name", "time", "example"}, f"exam.sections.{i}")
        for k, v in item.items(): text(v, f"exam.sections.{i}.{k}")
    if not isinstance(exam["vocabulary"], list) or not 1 <= len(exam["vocabulary"]) <= 20:
        raise FactoryError("recipe_schema", "invalid_vocabulary", "exam.vocabulary")
    for word in exam["vocabulary"]: text(word, "exam.vocabulary")
    require(exam["skin"], {"background", "foreground", "accent", "muted"}, {"background", "foreground", "accent", "muted"}, "exam.skin")
    for k, color in exam["skin"].items():
        if not isinstance(color, str) or not re.fullmatch(r"#[a-fA-F0-9]{6}", color):
            raise FactoryError("recipe_schema", "invalid_color", "exam.skin." + k)
    languages = raw["languages"]
    if not isinstance(languages, list) or not 1 <= len(languages) <= 40 or len(set(languages)) != len(languages):
        raise FactoryError("recipe_schema", "invalid_languages", "languages")
    for lang in languages: identifier(lang)
    names, total = set(), 0
    if not isinstance(raw["files"], list): raise FactoryError("recipe_schema", "invalid_files", "files")
    for f in raw["files"]:
        require(f, {"key", "bytes", "sha256"}, {"key", "bytes", "sha256"}, "files")
        object_key(f["key"])
        if f["key"] in names or type(f["bytes"]) is not int or not 0 < f["bytes"] <= MAX_FILE_BYTES or not SHA.fullmatch(str(f["sha256"])):
            raise FactoryError("recipe_schema", "invalid_file", f["key"])
        names.add(f["key"]); total += f["bytes"]
    if total > MAX_PACKAGE_BYTES: raise FactoryError("recipe_schema", "package_too_large", "files")
    if not isinstance(raw["videos"], list) or not raw["videos"]:
        raise FactoryError("recipe_schema", "invalid_videos", "videos")
    seen = set()
    for video in raw["videos"]:
        fields = {"video_id", "language", "audio", "alignment", "font", "dog", "bed", "scenes", "cta", "telegram", "outro_ms"}
        require(video, fields, fields - {"bed"}, "video")
        identifier(video["video_id"])
        if video["language"] not in languages or video["language"] in seen:
            raise FactoryError("recipe_schema", "invalid_language", "video.language")
        seen.add(video["language"])
        # Declared-but-not-present assets are handled together by preflight.
        for key in ("audio", "alignment", "font", "dog", "bed"):
            if key in video: object_key(video[key])
        text(video["cta"], "video.cta"); text(video["telegram"], "video.telegram", 200)
        number(video["outro_ms"], "video.outro_ms", 1000, 10000)
        if not isinstance(video["scenes"], list) or len(video["scenes"]) != 7:
            raise FactoryError("recipe_schema", "seven_scenes_required", "video.scenes")
        for i, scene in enumerate(video["scenes"]):
            require(scene, {"kind", "heading", "body", "weight", "forbidden"}, {"kind", "heading", "body", "weight", "forbidden"}, f"scenes.{i}")
            if scene["kind"] != SCENES[i]: raise FactoryError("recipe_schema", "scene_order", f"scenes.{i}.kind")
            text(scene["heading"], f"scenes.{i}.heading"); text(scene["body"], f"scenes.{i}.body")
            number(scene["weight"], f"scenes.{i}.weight", 0.01, 100)
            if not isinstance(scene["forbidden"], list) or len(scene["forbidden"]) > 20: raise FactoryError("recipe_schema", "invalid_exclusions", f"scenes.{i}.forbidden")
            for rect in scene["forbidden"]: rectangle(rect, "forbidden")
    for entry in raw.get("completed", []):
        require(entry, {"language", "receipt"}, {"language", "receipt"}, "completed")
        identifier(entry["language"])
        r = entry["receipt"]
        if not isinstance(r, dict) or r.get("storage_type") != "local" or type(r.get("bytes")) is not int or r["bytes"] <= 0 or not SHA.fullmatch(str(r.get("sha256", ""))):
            raise FactoryError("recipe_schema", "invalid_receipt", "completed.receipt")
        object_key(r.get("object_key"))
        if r.get("read_root") not in (None, "brain-archive"): raise FactoryError("recipe_schema", "invalid_receipt_root", "completed.receipt")
    return raw


def redact(lines, secrets=()):
    result = []
    for line in str(lines).splitlines()[-200:]:
        for secret in secrets:
            if secret: line = line.replace(secret, "[REDACTED]")
        line = re.sub(r"https?://\S+", "[REDACTED_URL]", line)
        line = re.sub(r"(?i)(authorization|cookie|token|secret|password|signature|api[_-]?key)\s*[:=]\s*\S+", r"\1=[REDACTED]", line)
        line = re.sub(r"\b[A-Za-z0-9_-]{48,}\b", "[REDACTED_VALUE]", line)
        result.append(line[:400])
    return result


def overlaps(a, b):
    return a["left"] < b["right"] and a["right"] > b["left"] and a["top"] < b["bottom"] and a["bottom"] > b["top"]


def check_layout(records, zone, expected_frames):
    frames = set()
    for record in records:
        frame = record["frame"]
        frames.add(frame)
        for box in record["boxes"]:
            if any(not math.isfinite(box[k]) for k in SAFE_ZONE) or not (zone["left"] <= box["left"] <= box["right"] <= zone["right"] and zone["top"] <= box["top"] <= box["bottom"] <= zone["bottom"]):
                raise FactoryError("qa_zone", "outside_safe_zone", "Text outside safe zone", frame=frame, scene=record["scene"], field=box.get("id"))
            if any(overlaps(box, rect) for rect in record.get("forbidden", [])):
                raise FactoryError("qa_zone", "reserved_overlap", "Text overlaps scene element", frame=frame, scene=record["scene"], field=box.get("id"))
    if frames != set(expected_frames):
        raise FactoryError("qa_zone", "layout_frames_missing", "Layout evidence does not cover every requested frame")
    return {"ok": True, "frames_checked": len(frames)}


def alignment(raw, duration_ms):
    if not isinstance(raw, list) or not raw: raise FactoryError("tts_align", "alignment_missing", "Character alignment required")
    previous, captions, words = 0, [], ""
    start = 0
    for item in raw:
        require(item, {"character", "start", "end"}, {"character", "start", "end"}, "alignment")
        number(item["start"], "alignment.start", 0, duration_ms / 1000)
        number(item["end"], "alignment.end", 0, duration_ms / 1000)
        finish = (item["start"] + item["end"]) * 1000
        if item["start"] * 1000 < previous - 1 or finish > duration_ms + 1:
            raise FactoryError("tts_align", "alignment_out_of_range", "Character start + length outside audio")
        if not words: start = item["start"] * 1000
        if not isinstance(item["character"], str) or len(item["character"]) > 8: raise FactoryError("tts_align", "invalid_character", "alignment.character")
        words += item["character"]; previous = finish
        if len(words) >= 70 and item["character"].isspace() or item["character"] in ".!?":
            captions.append({"start_ms": start, "end_ms": finish, "text": re.sub("kájló", "Kylo", words, flags=re.I).strip()}); words = ""
    if words.strip(): captions.append({"start_ms": start, "end_ms": previous, "text": re.sub("kájló", "Kylo", words, flags=re.I).strip()})
    return captions