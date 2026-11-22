#!/usr/bin/env python3
"""Sanitized, attempt-bound failure reports for KyLogic (video-factory-failure-report-v1).

Embedded in the manager's durable final_error result. Every output field is typed and validated;
identity comes from the authoritative job state and is compared with the local
failure file. Codes come only from the versioned renderer_error_codes.json list;
input keys only from the bound recipe's input inventory. Nothing else leaves.
"""
import hashlib
import json
import re
import sqlite3
import time
import uuid
from pathlib import Path

SCHEMA = "video-factory-failure-report-v1"
MAX_SAFE = 2**53 - 1
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
TOKEN_RE = re.compile(r"\b[a-z][a-z0-9_]{2,63}\b")
SCENE_RE = re.compile(r"\bscene[ _=:#-]*(\d{1,3})\b", re.I)
FRAME_RE = re.compile(r"\bframe[ _=:#-]*(\d{1,6})\b", re.I)
STAGES = ("assets", "render", "tight_cut", "verify", "archive", "unknown")
STAGE_HINTS = (("tight_cut", "tight_cut"), ("verify_video", "verify"), ("archive", "archive"),
               ("readable_inputs", "assets"), ("Inputs", "assets"), ("render", "render"))
TOP_CODES = ("render_or_verification_failed", "low_disk", "archive_conflict", "media_checksum_failed",
             "renderer_review_required", "archive_readback_failed", "unsafe_render_output")
_CODES = json.loads((Path(__file__).parent / "renderer_error_codes_v2.json").read_text())
CODES_VERSION, KNOWN_CODES = _CODES["version"], frozenset(_CODES["codes"])


class CanonicalError(ValueError):
    pass


# ------------------------------------------------------------ strict canonical form
def _check(v, depth=0):
    if depth > 16:
        raise CanonicalError("canonical_too_deep")
    if v is None or isinstance(v, bool):
        return
    if isinstance(v, int):
        if abs(v) > MAX_SAFE:
            raise CanonicalError("canonical_unsafe_integer")
        return
    if isinstance(v, float):
        raise CanonicalError("canonical_float_forbidden")  # use fixed-point integers
    if isinstance(v, str):
        try:
            v.encode("utf-8")
        except UnicodeEncodeError:
            raise CanonicalError("canonical_invalid_unicode")
        return
    if isinstance(v, list):
        for x in v:
            _check(x, depth + 1)
        return
    if isinstance(v, dict):
        for k, x in v.items():
            if not isinstance(k, str) or not k.isascii():
                raise CanonicalError("canonical_key_not_ascii")
            _check(x, depth + 1)
        return
    raise CanonicalError("canonical_type_forbidden")


def canonical(value):
    """Keys sorted (ASCII only, so code-point order is identical in JS), no spaces,
    UTF-8, integers within +/-2^53-1, no floats/NaN/Infinity."""
    _check(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def parse_strict(data):
    def pairs(items):
        keys = [k for k, _ in items]
        if len(keys) != len(set(keys)):
            raise CanonicalError("canonical_duplicate_key")
        return dict(items)
    def bad(_):
        raise CanonicalError("canonical_float_forbidden")
    try:
        value = json.loads(data.decode("utf-8", "strict") if isinstance(data, bytes) else data,
                           object_pairs_hook=pairs, parse_float=bad, parse_constant=bad)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise CanonicalError("canonical_parse_failed")
    _check(value)
    return value


def self_hash(obj, field):
    return hashlib.sha256(canonical({k: v for k, v in obj.items() if k != field})).hexdigest()


# ------------------------------------------------------------ report building
def _uint(v, hi):
    return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= hi else None


def _id(v):
    return v if isinstance(v, str) and ID_RE.fullmatch(v) else None


def _stage(where):
    text = " ".join(w for w in where if isinstance(w, str))
    for hint, stage in STAGE_HINTS:
        if hint in text:
            return stage
    return "unknown"


def build(stored, job, agent_id, input_keys, now=None):
    """`job` = authoritative state row {id, recipe, version, attempts, recipe_sha256};
    `input_keys` = the bound recipe's input inventory."""
    now = int(now or time.time())
    if not (_id(agent_id) and isinstance(job, dict) and _id(job.get("id")) and _id(job.get("recipe"))
            and _id(job.get("version")) and isinstance(job.get("recipe_sha256"), str)
            and HEX64.fullmatch(job["recipe_sha256"]) and _uint(job.get("attempts"), 1000) is not None):
        raise ValueError("failure_report_job_identity_invalid")
    report = {"schema_version": SCHEMA, "codes_version": CODES_VERSION, "report_id": str(uuid.uuid4()),
              "agent_id": agent_id, "job_id": job["id"], "attempt": job["attempts"],
              "recipe_id": job["recipe"], "recipe_version": job["version"],
              "recipe_sha256": job["recipe_sha256"], "reported_at": now, "production_authorized": False}
    reason = _unbound_reason(stored, job)
    if reason:
        report.update(status="diagnostic_unavailable", reason=reason, errors=[],
                      failure_id=hashlib.sha256(canonical([job["id"], job["attempts"], "unavailable"])).hexdigest())
    else:
        detail = stored["detail"]
        texts = [detail.get(k) for k in ("message", "stderr_tail")]
        text = "\n".join(t[:8000] for t in texts if isinstance(t, str))
        found = sorted({t for t in TOKEN_RE.findall(text) if t in KNOWN_CODES})
        err = {"stage": _stage(detail.get("where") if isinstance(detail.get("where"), list) else []),
               "code": stored["code"] if stored.get("code") in TOP_CODES else "render_or_verification_failed",
               "detail_codes": found[:20] or ["unknown_renderer_error"], "failed_at": stored["at"]}
        if (c := _uint(stored.get("cursor"), 10000)) is not None:
            err["cursor"] = c
        if (m := SCENE_RE.search(text)):
            err["scene"] = int(m.group(1))
        if (m := FRAME_RE.search(text)):
            err["frame"] = int(m.group(1))
        allowed = {k for k in input_keys if isinstance(k, str) and ID_RE.fullmatch(k.replace("/", "-"))}
        keys = sorted(k for k in allowed if re.search(r"(?<![\w/.-])" + re.escape(k) + r"(?![\w/.-])", text))
        if keys:
            err["input_keys"] = keys[:10]
        report.update(status="failed", errors=[err],
                      failure_id=hashlib.sha256(canonical([job["id"], job["attempts"], stored["at"], err["code"]])).hexdigest())
    report["report_sha256"] = self_hash(report, "report_sha256")
    return report


def _unbound_reason(stored, job):
    if not isinstance(stored, dict) or not isinstance(stored.get("detail"), dict):
        return "failure_record_missing_or_malformed"
    if stored.get("job_id") != job["id"]:
        return "failure_record_other_job"
    if stored.get("recipe_id") != job["recipe"] or stored.get("version") != job["version"]:
        return "failure_record_recipe_mismatch"
    if "attempt" not in stored or stored.get("attempt") != job["attempts"]:
        return "failure_record_attempt_unproven"
    if _uint(stored.get("at"), MAX_SAFE) is None or stored["at"] == 0:
        return "failure_record_time_invalid"
    return None


# ------------------------------------------------------------ durable outbox
class Conflict(Exception):
    pass


class Outbox:
    def __init__(self, path):
        self.db = sqlite3.connect(path, isolation_level=None, timeout=10)
        self.db.execute("CREATE TABLE IF NOT EXISTS failure_outbox(failure_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, attempt INTEGER NOT NULL, "
                        "report_id TEXT UNIQUE NOT NULL, agent_id TEXT NOT NULL, report_sha256 TEXT NOT NULL, body BLOB NOT NULL, acked_at INTEGER)")

    def put(self, report):
        """Atomic insert keyed by failure_id. Same content (ignoring report_id/time) returns the stored original."""
        body = canonical(report)
        self.db.execute("INSERT OR IGNORE INTO failure_outbox VALUES(?,?,?,?,?,?,?,NULL)",
                        (report["failure_id"], report["job_id"], report["attempt"], report["report_id"],
                         report["agent_id"], report["report_sha256"], body))
        stored = json.loads(self.db.execute("SELECT body FROM failure_outbox WHERE failure_id=?", (report["failure_id"],)).fetchone()[0])
        volatile = ("report_id", "reported_at", "report_sha256")
        if {k: v for k, v in stored.items() if k not in volatile} != {k: v for k, v in report.items() if k not in volatile}:
            raise Conflict("failure_report_conflict")
        return stored

    def pending(self):
        return [json.loads(b) for (b,) in self.db.execute("SELECT body FROM failure_outbox WHERE acked_at IS NULL ORDER BY rowid")]

    def ack(self, report_id, report_sha256, agent_id, now=None):
        cur = self.db.execute("UPDATE failure_outbox SET acked_at=? WHERE report_id=? AND report_sha256=? AND agent_id=? AND acked_at IS NULL",
                              (int(now or time.time()), report_id, report_sha256, agent_id))
        return cur.rowcount == 1
