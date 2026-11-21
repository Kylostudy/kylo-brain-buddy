#!/usr/bin/env python3
"""Sanitized, job-bound failure reports for KyLogic (video-factory-preflight-v1).

Not wired into agent.py yet: it only builds reports from the locally stored
last-render-failure.json and keeps a durable outbox. No free text, stack
traces, renderer output, environment, secrets or absolute paths leave the VPS;
only allowlisted codes and structured fields.
"""
import hashlib
import json
import re
import sqlite3
import time
import uuid

SCHEMA = "video-factory-failure-report-v1"
CODE_RE = re.compile(r"\b((?:sim|piggy|exam|universal|ielts|caption|layout|media|input|archive|recipe|renderer|cut|verify|font)_[a-z0-9_]{2,60})\b")
SCENE_RE = re.compile(r"\bscene[ _=:#-]*(\d{1,3})\b", re.I)
FRAME_RE = re.compile(r"\bframe[ _=:#-]*(\d{1,6})\b", re.I)
KEY_RE = re.compile(r"\b(?:audio|image|video|font|timing|recipe)/[a-z0-9][a-z0-9._-]{0,80}\b")
STAGES = ("assets", "render", "tight_cut", "verify", "archive", "unknown")
STAGE_HINTS = (("tight_cut", "tight_cut"), ("verify_video", "verify"), ("archive", "archive"),
               ("docker", "render"), ("remotion", "render"), ("readable_inputs", "assets"), ("Inputs", "assets"))


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sha(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def _stage(detail):
    text = " ".join(detail.get("where") or [])
    for hint, stage in STAGE_HINTS:
        if hint in text:
            return stage
    return "render" if "stderr_tail" in detail else "unknown"


def build(stored, job_id, agent_id, recipe_sha256, now=None):
    """Report for `job_id` only; another job's failure becomes diagnostic_unavailable."""
    now = int(now or time.time())
    report = {"schema_version": SCHEMA, "report_id": str(uuid.uuid4()), "job_id": job_id,
              "agent_id": agent_id, "recipe_sha256": recipe_sha256, "reported_at": now,
              "production_authorized": False}
    if not isinstance(stored, dict) or stored.get("job_id") != job_id:
        report.update(status="diagnostic_unavailable", errors=[])
    else:
        detail = stored.get("detail") or {}
        text = "\n".join(str(detail.get(k, "")) for k in ("message", "stderr_tail"))
        codes = sorted(set(CODE_RE.findall(text)))
        err = {"stage": _stage(detail), "code": str(stored.get("code", "render_or_verification_failed"))[:64],
               "detail_codes": codes[:20], "failed_at": int(stored.get("at", 0)),
               "recipe_id": stored.get("recipe_id"), "recipe_version": stored.get("version"),
               "video_id": stored.get("video_id"), "cursor": stored.get("cursor")}
        if (m := SCENE_RE.search(text)):
            err["scene"] = int(m.group(1))
        if (m := FRAME_RE.search(text)):
            err["frame"] = int(m.group(1))
        keys = sorted(set(KEY_RE.findall(text)))
        if keys:
            err["input_keys"] = keys[:10]
        if not CODE_RE.fullmatch(err["code"]) and err["code"] != "render_or_verification_failed":
            err["code"] = "render_or_verification_failed"
        report.update(status="failed", errors=[err])
    report["report_sha256"] = sha(report)
    return report


class Outbox:
    """Durable outbox; a report leaves only after a matching ACK."""
    def __init__(self, path):
        self.db = sqlite3.connect(path, isolation_level=None)
        self.db.execute("CREATE TABLE IF NOT EXISTS failure_outbox(job_id TEXT PRIMARY KEY, report_sha256 TEXT NOT NULL, body BLOB NOT NULL, acked_at INTEGER)")

    def put(self, report):
        row = self.db.execute("SELECT report_sha256 FROM failure_outbox WHERE job_id=?", (report["job_id"],)).fetchone()
        if row:
            return row[0] == report["report_sha256"] or "kept_original"
        self.db.execute("INSERT INTO failure_outbox VALUES(?,?,?,NULL)", (report["job_id"], report["report_sha256"], canonical(report)))
        return True

    def pending(self):
        return [json.loads(b) for (b,) in self.db.execute("SELECT body FROM failure_outbox WHERE acked_at IS NULL ORDER BY rowid")]

    def ack(self, job_id, report_sha256, now=None):
        cur = self.db.execute("UPDATE failure_outbox SET acked_at=? WHERE job_id=? AND report_sha256=? AND acked_at IS NULL",
                              (int(now or time.time()), job_id, report_sha256))
        return cur.rowcount == 1
