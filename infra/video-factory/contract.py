"""Non-executable, versioned recipe and command contract. No rendering here."""
import hashlib
import json
import re
import uuid

VERSION = 1
BATCH_SIZE = 5
MAX_ATTEMPTS = 3
MAX_MANIFEST_BYTES = 512 * 1024
MAX_PACKAGE_BYTES = 600 * 1024 * 1024
MAX_FILE_BYTES = 40 * 1024 * 1024
OPERATIONS = {"register_recipe", "trial", "start_series", "status", "preview", "pause", "resume", "retry"}
ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,79}\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")
IELTS_LANGUAGES = set("en de nl fr ja es pt it ko pl no sv cs tr sk sl da fi ar hi sr ru ro hr el hu zh".split())
# Owner policy 2026-10-24: a continuation may only manufacture these 11 missing
# languages; the other 16 must arrive as verified archive receipts, never re-rendered.
CONTINUATION_LANGUAGES = set("ar da hi ja ko ru sk sl sr sv tr".split())
# Approved Hungarian Cambridge B2 First v2 trial (owner approval 2026-10-28); the only allowed Cambridge continuation anchor.
CAMBRIDGE_HU_V2_KEY = "cambridge-b2-first-hu-trial/v2/cambridge-b2-first-hu"
CAMBRIDGE_HU_V2_SHA = "781a47ce0d6b74542245bd8c07c2166ac0f84be64ee3880b868947b9fe16dc06"
CAMBRIDGE_HU_V2_BYTES = 7038003


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def identifier(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError("invalid_identifier")
    return value


def object_key(value):
    if not isinstance(value, str) or not value or len(value) > 240:
        raise ValueError("invalid_object_key")
    if any(not ID.fullmatch(p) for p in value.split("/")):
        raise ValueError("invalid_object_key")
    return value


def keys(value, allowed, required):
    if not isinstance(value, dict) or set(value) - set(allowed) or not set(required) <= set(value):
        raise ValueError("unsupported_fields")


def validate_recipe(raw):
    if isinstance(raw, dict) and raw.get("schema_version") == 2:
        from universal import validate
        return validate(raw)
    keys(raw, {"schema_version", "recipe_id", "version", "renderer", "series", "languages", "files", "videos", "continuation"},
         {"schema_version", "recipe_id", "version", "renderer", "series", "languages", "files", "videos"})
    if len(canonical(raw)) > MAX_MANIFEST_BYTES or raw["schema_version"] != VERSION:
        raise ValueError("invalid_manifest")
    identifier(raw["recipe_id"])
    identifier(raw["version"])
    identifier(raw["renderer"])
    if raw["series"] not in {"professional", "ielts", "cambridge", "other"}:
        raise ValueError("unsupported_series")
    languages = raw["languages"]
    if not isinstance(languages, list) or not 1 <= len(languages) <= 40 or len(set(languages)) != len(languages):
        raise ValueError("invalid_languages")
    for language in languages:
        identifier(language)
    continuation = raw.get("continuation")
    if continuation is not None:
        keys(continuation, {"trial_recipe_id", "trial_version", "completed", "blocked_languages"}, {"trial_recipe_id", "trial_version", "completed"})
        identifier(continuation["trial_recipe_id"])
        identifier(continuation["trial_version"])
        if raw["series"] not in {"ielts", "cambridge"} or not isinstance(continuation["completed"], list):
            raise ValueError("invalid_continuation")
        completed = set()
        for item in continuation["completed"]:
            keys(item, {"language", "receipt"}, {"language", "receipt"})
            if item["language"] in completed:
                raise ValueError("duplicate_completed_language")
            completed.add(item["language"])
            receipt = item["receipt"]
            if not isinstance(receipt, dict) or receipt.get("storage_type") != "local" or type(receipt.get("bytes")) is not int or receipt["bytes"] < 1 or not SHA.fullmatch(str(receipt.get("sha256", ""))):
                raise ValueError("invalid_completed_receipt")
            object_key(receipt.get("object_key"))
            if receipt.get("read_root") not in (None, "brain-archive"):
                raise ValueError("invalid_completed_receipt")
        blocked = set()
        entries = continuation.get("blocked_languages", [])
        if not isinstance(entries, list):
            raise ValueError("invalid_blocked_languages")
        for item in entries:
            keys(item, {"language", "reason"}, {"language", "reason"})
            if not isinstance(item["language"], str) or item["language"] not in CONTINUATION_LANGUAGES or item["language"] in blocked:
                raise ValueError("invalid_blocked_languages")
            if not isinstance(item["reason"], str) or not item["reason"].strip() or len(item["reason"]) > 240:
                raise ValueError("blocked_language_reason_required")
            blocked.add(item["language"])
        if raw["series"] == "ielts" and (not set(languages) <= CONTINUATION_LANGUAGES or blocked & set(languages) or not set(languages)):
            raise ValueError("continuation_languages_restricted")
        if completed & (set(languages) | blocked) or completed | set(languages) | blocked != IELTS_LANGUAGES:
            raise ValueError("continuation_must_cover_27_without_repeats")
        if raw["series"] == "cambridge":
            if (blocked or raw.get("renderer") not in ("exam-promo-profiles-safe-v2", "exam-promo-profiles-safe-v3")
                    or continuation["trial_recipe_id"] != "cambridge-b2-first-hu-trial"
                    or continuation["trial_version"] != "v2"
                    or completed != {"hu"}
                    or len(raw["videos"]) != 26):
                raise ValueError("invalid_cambridge_continuation")
            receipt = continuation["completed"][0]["receipt"]
            if (receipt["object_key"] != CAMBRIDGE_HU_V2_KEY or receipt["sha256"] != CAMBRIDGE_HU_V2_SHA
                    or receipt["bytes"] != CAMBRIDGE_HU_V2_BYTES or receipt.get("read_root") is not None):
                raise ValueError("invalid_cambridge_trial_receipt")
    if raw["series"] == "ielts" and continuation is None and len(languages) != 27 and not (raw["recipe_id"] == "ielts-cs-trial" and languages == ["cs"] and len(raw["videos"]) == 1):
        raise ValueError("ielts_requires_27_languages")
    files = raw["files"]
    if not isinstance(files, list) or not 1 <= len(files) <= 10000:
        raise ValueError("invalid_file_list")
    names, total = set(), 0
    for f in files:
        keys(f, {"key", "bytes", "sha256"}, {"key", "bytes", "sha256"})
        name = object_key(f["key"])
        if name in names or not isinstance(f["bytes"], int) or isinstance(f["bytes"], bool) or not 1 <= f["bytes"] <= MAX_FILE_BYTES:
            raise ValueError("invalid_file")
        if not isinstance(f["sha256"], str) or not SHA.fullmatch(f["sha256"]):
            raise ValueError("invalid_checksum")
        names.add(name)
        total += f["bytes"]
    if total > MAX_PACKAGE_BYTES:
        raise ValueError("package_too_large")
    videos = raw["videos"]
    if not isinstance(videos, list) or not 1 <= len(videos) <= 10000:
        raise ValueError("invalid_video_list")
    ids, covered = set(), set()
    for video in videos:
        keys(video, {"video_id", "language", "width", "height", "duration_ms", "scene", "text", "subtitle", "cta", "audio", "master", "timing", "font"},
             {"video_id", "language", "width", "height", "duration_ms", "scene", "text", "subtitle", "cta", "audio", "master", "timing"})
        name = identifier(video["video_id"])
        if name in ids or video["language"] not in languages:
            raise ValueError("invalid_video_identity")
        ids.add(name)
        covered.add(video["language"])
        identifier(video["scene"])
        for key in ("width", "height", "duration_ms"):
            if type(video[key]) is not int or video[key] < 1:
                raise ValueError("invalid_dimensions_or_duration")
        if max(video["width"], video["height"]) > 3840 or video["duration_ms"] > 3600000:
            raise ValueError("render_limit")
        for key in ("text", "subtitle", "cta"):
            if not isinstance(video[key], str) or len(video[key]) > 50000:
                raise ValueError("invalid_text")
        for key in ("audio", "master"):
            if video[key] not in names:
                raise ValueError("missing_media_reference")
        if "font" in video:
            object_key(video["font"])
            if video["font"] not in names:
                raise ValueError("missing_font_reference")
        if not isinstance(video["timing"], list) or len(video["timing"]) > 2000:
            raise ValueError("invalid_timing")
        last = 0
        for t in video["timing"]:
            keys(t, {"start_ms", "end_ms"}, {"start_ms", "end_ms"})
            if type(t["start_ms"]) is not int or type(t["end_ms"]) is not int or not last <= t["start_ms"] < t["end_ms"] <= video["duration_ms"]:
                raise ValueError("invalid_timing")
            last = t["end_ms"]
    if (raw["series"] == "ielts" or (raw["series"] == "cambridge" and continuation is not None)) and covered != set(languages):
        raise ValueError("ielts_missing_language_video")
    return raw


def validate_command(raw):
    if isinstance(raw, dict) and raw.get("schema_version") == 2:
        return validate_universal_command(raw)
    keys(raw, {"schema_version", "delivery_id", "operation", "payload"}, {"schema_version", "delivery_id", "operation", "payload"})
    if raw["schema_version"] != VERSION or raw["operation"] not in OPERATIONS:
        raise ValueError("unsupported_operation")
    if str(uuid.UUID(raw["delivery_id"])) != raw["delivery_id"]:
        raise ValueError("invalid_delivery_id")
    payload = raw["payload"]
    op = raw["operation"]
    if op == "register_recipe":
        validate_recipe(payload)
    elif op in {"trial", "start_series"}:
        allowed = {"recipe_id", "version"} | ({"approval"} if op == "start_series" else set())
        keys(payload, allowed, allowed)
        identifier(payload["recipe_id"])
        identifier(payload["version"])
        if op == "start_series":
            approval = payload["approval"]
            keys(approval, {"approval_id", "recipe_sha256", "trial_receipt_sha256", "approved_at", "owner_authorized"},
                 {"approval_id", "recipe_sha256", "trial_receipt_sha256", "approved_at", "owner_authorized"})
            if str(uuid.UUID(approval["approval_id"])) != approval["approval_id"] or approval["owner_authorized"] is not True:
                raise ValueError("owner_approval_required")
            for key in ("recipe_sha256", "trial_receipt_sha256"):
                if not isinstance(approval[key], str) or not SHA.fullmatch(approval[key]):
                    raise ValueError("invalid_approval_binding")
            if type(approval["approved_at"]) is not int:
                raise ValueError("invalid_approval_time")
    elif op == "preview":
        keys(payload, {"video_id"}, {"video_id"})
        object_key(payload["video_id"])
    else:
        keys(payload, {"job_id"}, {"job_id"})
        if str(uuid.UUID(payload["job_id"])) != payload["job_id"]:
            raise ValueError("invalid_job_id")
    return raw


def validate_universal_command(raw):
    from universal import OPERATIONS, FactoryError
    keys(raw, {"schema_version", "delivery_id", "operation", "payload"}, {"schema_version", "delivery_id", "operation", "payload"})
    if str(uuid.UUID(raw["delivery_id"])) != raw["delivery_id"] or raw["operation"] not in OPERATIONS:
        raise FactoryError("command", "unsupported_operation", "Unsupported command")
    op, p = raw["operation"], raw["payload"]
    if op == "register_recipe":
        if p.get("schema_version") != 2: raise FactoryError("command", "universal_recipe_required", "Version two recipe required")
        validate_recipe(p)
    elif op in {"preview", "trial", "series_run", "rerender"}:
        keys(p, {"recipe_id", "version", "languages", "approval", "rerender"}, {"recipe_id", "version"} | ({"approval"} if op in {"series_run", "rerender"} else set()))
        identifier(p["recipe_id"]); identifier(p["version"])
        for name in ("languages", "rerender"):
            if name in p:
                if not isinstance(p[name], list) or not p[name] or len(p[name]) > 40 or len(set(p[name])) != len(p[name]):
                    raise FactoryError("command", "invalid_languages", name)
                for lang in p[name]: identifier(lang)
        if op in {"series_run", "rerender"}:
            if op == "rerender" and not p.get("rerender"): raise FactoryError("command", "explicit_rerender_required", "rerender list required")
            a = p["approval"]
            keys(a, {"approval_id", "recipe_sha256", "trial_receipt_sha256", "approved_at", "owner_authorized"}, {"approval_id", "recipe_sha256", "trial_receipt_sha256", "approved_at", "owner_authorized"})
            if str(uuid.UUID(a["approval_id"])) != a["approval_id"] or a["owner_authorized"] is not True:
                raise FactoryError("command", "owner_approval_required", "Explicit owner approval required")
            if not all(SHA.fullmatch(str(a[k])) for k in ("recipe_sha256", "trial_receipt_sha256")) or type(a["approved_at"]) is not int:
                raise FactoryError("command", "invalid_approval", "Approval binding required")
    elif op == "inventory":
        keys(p, set(), set())
    else:
        keys(p, {"job_id", "language", "artifact"}, {"job_id"})
        if str(uuid.UUID(p["job_id"])) != p["job_id"]: raise FactoryError("command", "invalid_job", "job_id")
        if "language" in p: identifier(p["language"])
        if "artifact" in p and p["artifact"] not in {"contact", "layout", "video"}: raise FactoryError("command", "invalid_artifact", "artifact")
    return raw