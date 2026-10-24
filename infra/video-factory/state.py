"""Durable single-video scheduling with an outbox. SQLite is host-local only."""
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import time
import uuid
from contract import BATCH_SIZE, MAX_ATTEMPTS, canonical, digest, validate_command


class State:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.transaction() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS recipes(id TEXT, version TEXT, hash TEXT, manifest TEXT, PRIMARY KEY(id,version));
            CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY, hash TEXT, result TEXT);
            CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, recipe TEXT, version TEXT, mode TEXT, status TEXT, attempts INTEGER DEFAULT 0, cursor INTEGER DEFAULT 0, lease TEXT, expires INTEGER, trial_receipt TEXT, UNIQUE(recipe,version,mode));
            CREATE TABLE IF NOT EXISTS outputs(video_id TEXT PRIMARY KEY, receipt TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, body TEXT NOT NULL, sent INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, at INTEGER, kind TEXT, entity TEXT);
            """)

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        db.execute("BEGIN IMMEDIATE")
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def emit(self, db, kind, entity, result):
        db.execute("INSERT INTO events(at,kind,entity) VALUES(?,?,?)", (int(time.time()), kind, entity))
        body = {"schema_version": 1, "event_id": str(uuid.uuid4()), "kind": kind, "entity_id": entity, "result": result}
        db.execute("INSERT INTO outbox(id,body) VALUES(?,?)", (body["event_id"], canonical(body).decode()))

    def apply(self, command):
        validate_command(command)
        cid, op, p = command["delivery_id"], command["operation"], command["payload"]
        identity = digest(command)
        with self.transaction() as db:
            previous = db.execute("SELECT * FROM commands WHERE id=?", (cid,)).fetchone()
            if previous:
                if previous["hash"] != identity:
                    raise ValueError("delivery_identity_conflict")
                return json.loads(previous["result"])
            if op == "register_recipe":
                row = db.execute("SELECT hash FROM recipes WHERE id=? AND version=?", (p["recipe_id"], p["version"])).fetchone()
                if row and row["hash"] != digest(p):
                    raise ValueError("immutable_recipe_conflict")
                db.execute("INSERT OR IGNORE INTO recipes VALUES(?,?,?,?)", (p["recipe_id"], p["version"], digest(p), canonical(p).decode()))
                result = {"status": "registered", "recipe_sha256": digest(p)}
            elif op in {"trial", "start_series"}:
                recipe = db.execute("SELECT * FROM recipes WHERE id=? AND version=?", (p["recipe_id"], p["version"])).fetchone()
                if not recipe:
                    raise ValueError("recipe_not_registered")
                manifest = json.loads(recipe["manifest"])
                mode = "trial" if op == "trial" else "series"
                if mode == "series":
                    trial = db.execute("SELECT * FROM jobs WHERE recipe=? AND version=? AND mode='trial' AND status='completed'", (p["recipe_id"], p["version"])).fetchone()
                    approval = p["approval"]
                    if not trial or recipe["hash"] != approval["recipe_sha256"] or digest(json.loads(trial["trial_receipt"])) != approval["trial_receipt_sha256"]:
                        raise ValueError("verified_trial_approval_required")
                    if not 0 < approval["approved_at"] <= int(time.time()) + 60:
                        raise ValueError("invalid_approval_time")
                    if manifest["series"] not in {"professional", "ielts"}:
                        # All prior IELTS series must be complete, and one must exist.
                        rows = db.execute("SELECT j.status,r.manifest FROM jobs j JOIN recipes r ON r.id=j.recipe AND r.version=j.version WHERE j.mode='series'").fetchall()
                        ielts = [r for r in rows if json.loads(r["manifest"])["series"] == "ielts"]
                        if not ielts or any(r["status"] != "completed" for r in ielts):
                            raise ValueError("ielts_first_required")
                jid = str(uuid.uuid4())
                db.execute("INSERT OR IGNORE INTO jobs(id,recipe,version,mode,status) VALUES(?,?,?,?,?)", (jid, p["recipe_id"], p["version"], mode, "queued"))
                row = db.execute("SELECT id,status FROM jobs WHERE recipe=? AND version=? AND mode=?", (p["recipe_id"], p["version"], mode)).fetchone()
                result = dict(row)
            elif op == "preview":
                output = db.execute("SELECT receipt FROM outputs WHERE video_id=?", (p["video_id"],)).fetchone()
                result = {"status": "available" if output else "missing", "video_id": p["video_id"], "requires_authenticated_stream": True}
            else:
                job = db.execute("SELECT * FROM jobs WHERE id=?", (p["job_id"],)).fetchone()
                if not job:
                    raise ValueError("job_not_found")
                if op == "pause" and job["status"] != "completed":
                    # Running video finishes first; its completion preserves pause.
                    db.execute("UPDATE jobs SET status='paused' WHERE id=?", (job["id"],))
                elif op == "resume" and job["status"] == "paused":
                    db.execute("UPDATE jobs SET status=CASE WHEN lease IS NULL THEN 'queued' ELSE 'rendering' END WHERE id=?", (job["id"],))
                elif op == "retry":
                    if job["status"] not in {"failed", "blocked"} or job["attempts"] >= MAX_ATTEMPTS:
                        raise ValueError("retry_not_allowed")
                    db.execute("UPDATE jobs SET status='queued' WHERE id=?", (job["id"],))
                result = dict(db.execute("SELECT id,status,cursor,attempts FROM jobs WHERE id=?", (job["id"],)).fetchone())
            db.execute("INSERT INTO commands VALUES(?,?,?)", (cid, identity, canonical(result).decode()))
            self.emit(db, "command_result", cid, result)
            return result

    def claim(self, now=None):
        now = int(time.time()) if now is None else now
        with self.transaction() as db:
            db.execute("UPDATE jobs SET status=CASE WHEN status='paused' THEN 'paused' ELSE 'queued' END, lease=NULL,expires=NULL WHERE lease IS NOT NULL AND expires<?", (now,))
            if db.execute("SELECT 1 FROM jobs WHERE lease IS NOT NULL").fetchone():
                return None
            row = db.execute("SELECT j.*,r.manifest,r.hash FROM jobs j JOIN recipes r ON r.id=j.recipe AND r.version=j.version WHERE j.status='queued' ORDER BY j.rowid LIMIT 1").fetchone()
            if not row:
                return None
            lease = str(uuid.uuid4())
            db.execute("UPDATE jobs SET status='rendering',lease=?,expires=? WHERE id=?", (lease, now + 180, row["id"]))
            return {**dict(row), "lease": lease, "manifest": json.loads(row["manifest"])}

    def heartbeat(self, jid, lease):
        with self.transaction() as db:
            return db.execute("UPDATE jobs SET expires=? WHERE id=? AND lease=?", (int(time.time()) + 180, jid, lease)).rowcount == 1

    def output(self, video_id):
        with self.transaction() as db:
            row = db.execute("SELECT receipt FROM outputs WHERE video_id=?", (video_id,)).fetchone()
            return json.loads(row["receipt"]) if row else None

    def finish_video(self, job, video_id, receipt):
        with self.transaction() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=? AND lease=?", (job["id"], job["lease"])).fetchone()
            if not row:
                raise ValueError("lease_lost")
            encoded = canonical(receipt).decode()
            prior = db.execute("SELECT receipt FROM outputs WHERE video_id=?", (video_id,)).fetchone()
            if prior and prior["receipt"] != encoded:
                raise ValueError("output_identity_conflict")
            db.execute("INSERT OR IGNORE INTO outputs VALUES(?,?)", (video_id, encoded))
            cursor = row["cursor"] + 1
            total = 1 if row["mode"] == "trial" else len(job["manifest"]["videos"])
            status = "completed" if cursor == total else ("paused" if row["status"] == "paused" else "queued")
            db.execute("UPDATE jobs SET cursor=?,status=?,lease=NULL,expires=NULL,trial_receipt=? WHERE id=?", (cursor, status, encoded if row["mode"] == "trial" else None, job["id"]))
            if cursor % BATCH_SIZE == 0 or status == "completed":
                self.emit(db, "batch_verified", job["id"], {"cursor": cursor, "status": status, "last_receipt": receipt})

    def fail(self, job, code, blocked=False):
        with self.transaction() as db:
            changed = db.execute("UPDATE jobs SET status=?,attempts=attempts+1,lease=NULL,expires=NULL WHERE id=? AND lease=?", ("blocked" if blocked else "failed", job["id"], job["lease"])).rowcount
            if changed:
                self.emit(db, "final_error", job["id"], {"code": code})

    def pending(self):
        with self.transaction() as db:
            return [json.loads(r["body"]) for r in db.execute("SELECT body FROM outbox WHERE sent=0 ORDER BY rowid LIMIT 50")]

    def acknowledge(self, event_id):
        with self.transaction() as db:
            db.execute("UPDATE outbox SET sent=1 WHERE id=?", (event_id,))