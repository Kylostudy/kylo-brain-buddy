"""Additive universal job queue; never mutates legacy jobs or archive receipts."""
import json
import time
import uuid
from contract import canonical, digest, MAX_ATTEMPTS
from universal import LANGUAGES, FactoryError


def tables(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS universal_jobs(id TEXT PRIMARY KEY,recipe TEXT,version TEXT,mode TEXT,status TEXT,phase TEXT,plan TEXT,lease TEXT,expires INTEGER,attempts INTEGER DEFAULT 0,diagnostic TEXT);
    CREATE TABLE IF NOT EXISTS universal_items(job TEXT,language TEXT,video TEXT,status TEXT,output_key TEXT,preview TEXT,receipt TEXT,PRIMARY KEY(job,language));
    CREATE TABLE IF NOT EXISTS universal_outputs(recipe TEXT,language TEXT,output_key TEXT PRIMARY KEY,receipt TEXT);
    """)


def summary(db, jid):
    job = db.execute("SELECT * FROM universal_jobs WHERE id=?", (jid,)).fetchone()
    if not job: raise FactoryError("command", "job_not_found", "Unknown job")
    rows = db.execute("SELECT language,status,output_key,preview,receipt FROM universal_items WHERE job=? ORDER BY rowid", (jid,)).fetchall()
    return {"id": jid, "status": job["status"], "phase": job["phase"], "languages": [{**dict(r), "preview": json.loads(r["preview"]) if r["preview"] else None, "receipt": json.loads(r["receipt"]) if r["receipt"] else None} for r in rows], "error": json.loads(job["diagnostic"]) if job["diagnostic"] else None}


def apply(state, db, command):
    p, op = command["payload"], command["operation"]
    if op == "register_recipe":
        row = db.execute("SELECT hash FROM recipes WHERE id=? AND version=?", (p["recipe_id"], p["version"])).fetchone()
        if row and row["hash"] != digest(p): raise FactoryError("recipe_schema", "immutable_recipe_conflict", "Recipe version cannot change")
        for item in p.get("completed", []):
            if state.archive is None or not state.archive.verify(item["receipt"]): raise FactoryError("archive", "completed_archive_unverified", "Existing receipt could not be verified", language=item["language"])
        db.execute("INSERT OR IGNORE INTO recipes VALUES(?,?,?,?)", (p["recipe_id"], p["version"], digest(p), canonical(p).decode()))
        for item in p.get("completed", []):
            insert_output(db, p["recipe_id"], item["language"], item["receipt"])
        return {"status": "registered", "recipe_sha256": digest(p)}
    if op == "inventory":
        return {"jobs": [summary(db, r["id"]) for r in db.execute("SELECT id FROM universal_jobs ORDER BY rowid DESC LIMIT 50")], "outputs": [{**dict(r), "receipt": json.loads(r["receipt"])} for r in db.execute("SELECT * FROM universal_outputs ORDER BY rowid DESC LIMIT 1000")]}
    if op in {"preview", "trial", "series_run", "rerender"}:
        recipe = db.execute("SELECT * FROM recipes WHERE id=? AND version=?", (p["recipe_id"], p["version"])).fetchone()
        if not recipe: raise FactoryError("command", "recipe_not_registered", "Register recipe first")
        manifest = json.loads(recipe["manifest"])
        if manifest.get("schema_version") != 2: raise FactoryError("command", "universal_recipe_required", "Legacy recipe requires legacy command")
        requested = p.get("languages", LANGUAGES if op in {"series_run", "rerender"} else manifest["languages"])
        if op == "trial" and len(requested) != 1: raise FactoryError("command", "one_trial_language", "Trial requires exactly one language")
        rerender = set(p.get("rerender", []))
        if not rerender <= set(requested): raise FactoryError("command", "rerender_not_requested", "Rerender languages must be requested")
        if op in {"series_run", "rerender"}:
            approval = p["approval"]
            if approval["recipe_sha256"] != recipe["hash"] or not 0 < approval["approved_at"] <= time.time() + 60:
                raise FactoryError("command", "invalid_approval_binding", "Approval must match immutable recipe")
            trials = db.execute("SELECT i.receipt FROM universal_items i JOIN universal_jobs j ON j.id=i.job WHERE j.recipe=? AND j.version=? AND j.mode='trial' AND j.status='completed' AND i.receipt IS NOT NULL", (p["recipe_id"], p["version"])).fetchall()
            if not any(digest(json.loads(r["receipt"])) == approval["trial_receipt_sha256"] and state.archive is not None and state.archive.verify(json.loads(r["receipt"])) for r in trials):
                raise FactoryError("command", "verified_trial_approval_required", "Approve a verified trial for this recipe")
        jid = str(uuid.uuid4())
        version = f'{p["version"]}_v{time.time_ns()}_{jid[:8]}'
        plan = {"languages": requested, "rerender": sorted(rerender), "missing": [], "output_version": version}
        # Inventory before inspecting assets: already verified languages need no audio.
        videos = {v["language"]: v for v in manifest["videos"]}
        items = []
        for lang in requested:
            old = db.execute("SELECT receipt FROM universal_outputs WHERE recipe=? AND language=? ORDER BY rowid DESC LIMIT 1", (p["recipe_id"], lang)).fetchone()
            receipt = json.loads(old["receipt"]) if old else None
            if receipt and lang not in rerender:
                if state.archive is None or not state.archive.verify(receipt): raise FactoryError("archive", "archive_readback_failed", "Existing output cannot be skipped without verification", language=lang)
                status = "skipped"
            else: status = "pending"
            v = videos.get(lang)
            if status != "skipped" and not v:
                plan["missing"].append({"language": lang, "missing": ["translation", "audio", "alignment", "font"]})
            key = f'{p["recipe_id"]}/{version}/{v["video_id"] if v else "video-" + lang}'
            items.append((jid, lang, canonical(v).decode() if v else None, status, key, canonical(receipt).decode() if receipt else None))
        db.execute("INSERT INTO universal_jobs(id,recipe,version,mode,status,phase,plan) VALUES(?,?,?,?,?,?,?)", (jid, p["recipe_id"], p["version"], op, "queued", "preflight", canonical(plan).decode()))
        db.executemany("INSERT INTO universal_items(job,language,video,status,output_key,receipt) VALUES(?,?,?,?,?,?)", items)
        return summary(db, jid)
    job = db.execute("SELECT * FROM universal_jobs WHERE id=?", (p["job_id"],)).fetchone()
    if not job: raise FactoryError("command", "job_not_found", "Unknown universal job")
    if op == "pause" and job["status"] not in {"completed", "cancelled"}:
        db.execute("UPDATE universal_jobs SET status='paused' WHERE id=?", (job["id"],))
    elif op == "cancel" and job["status"] != "completed":
        db.execute("UPDATE universal_jobs SET status='cancelling' WHERE id=?", (job["id"],))
        if job["lease"] is None: db.execute("UPDATE universal_jobs SET status='cancelled' WHERE id=?", (job["id"],))
    elif op == "resume" and job["status"] == "paused":
        db.execute("UPDATE universal_jobs SET status=? WHERE id=?", ("running" if job["lease"] else "queued", job["id"]))
    elif op == "retry":
        if job["status"] not in {"failed", "blocked"} or job["attempts"] >= MAX_ATTEMPTS: raise FactoryError("command", "retry_not_allowed", "No retry available")
        db.execute("UPDATE universal_jobs SET status='queued',diagnostic=NULL WHERE id=?", (job["id"],))
    elif op == "logs":
        return {"id": job["id"], "error": json.loads(job["diagnostic"]) if job["diagnostic"] else None}
    elif op == "qa_fetch":
        row = db.execute("SELECT preview,receipt FROM universal_items WHERE job=? AND language=?", (job["id"], p.get("language"))).fetchone()
        if not row: raise FactoryError("qa_fetch", "language_not_found", "Language required")
        return {"id": job["id"], "requires_authenticated_stream": True, "qa": json.loads(row["preview"]) if row["preview"] else None, "receipt": json.loads(row["receipt"]) if row["receipt"] else None}
    return summary(db, job["id"])


def insert_output(db, recipe, language, receipt):
    old = db.execute("SELECT receipt FROM universal_outputs WHERE output_key=?", (receipt["object_key"],)).fetchone()
    encoded = canonical(receipt).decode()
    if old and old["receipt"] != encoded: raise FactoryError("archive", "receipt_conflict", "Archived receipt is immutable")
    db.execute("INSERT OR IGNORE INTO universal_outputs VALUES(?,?,?,?)", (recipe, language, receipt["object_key"], encoded))


def claim(state, now):
    with state.transaction() as db:
        expired = db.execute("SELECT * FROM universal_jobs WHERE lease IS NOT NULL AND expires<?", (now,)).fetchall()
        for j in expired:
            count = j["attempts"] + 1
            status = "failed" if count >= MAX_ATTEMPTS else ("cancelled" if j["status"] == "cancelling" else "paused" if j["status"] == "paused" else "queued")
            db.execute("UPDATE universal_jobs SET status=?,attempts=?,lease=NULL,expires=NULL WHERE id=?", (status, count, j["id"]))
            state.emit(db, "lease_recovered", j["id"], {"stage": "lease", "code": "lease_expired", "log_tail": [], "status": status})
        if db.execute("SELECT 1 FROM universal_jobs WHERE lease IS NOT NULL").fetchone() or db.execute("SELECT 1 FROM jobs WHERE lease IS NOT NULL").fetchone(): return None
        j = db.execute("SELECT * FROM universal_jobs WHERE status='queued' ORDER BY rowid LIMIT 1").fetchone()
        if not j: return None
        lease = str(uuid.uuid4())
        db.execute("UPDATE universal_jobs SET status='running',lease=?,expires=? WHERE id=?", (lease, now + 180, j["id"]))
        manifest = db.execute("SELECT manifest FROM recipes WHERE id=? AND version=?", (j["recipe"], j["version"])).fetchone()
        items = [dict(r) for r in db.execute("SELECT * FROM universal_items WHERE job=? ORDER BY rowid", (j["id"],))]
        return {**dict(j), "lease": lease, "universal": True, "manifest": json.loads(manifest["manifest"]), "plan": json.loads(j["plan"]), "items": items}


def commit(state, job, phase=None, language=None, preview=None, receipt=None):
    with state.transaction() as db:
        j = db.execute("SELECT * FROM universal_jobs WHERE id=? AND lease=? AND expires>=?", (job["id"], job["lease"], time.time())).fetchone()
        if not j: raise FactoryError("lease", "lease_lost", "Work lease expired")
        if language:
            if preview:
                db.execute("UPDATE universal_items SET preview=?,status='previewed' WHERE job=? AND language=?", (canonical(preview).decode(), j["id"], language))
            if receipt:
                insert_output(db, j["recipe"], language, receipt)
                db.execute("UPDATE universal_items SET receipt=?,status='completed' WHERE job=? AND language=?", (canonical(receipt).decode(), j["id"], language))
                state.emit(db, "video_verified", j["id"], {"language": language, "receipt": receipt})
                n = db.execute("SELECT count(*) FROM universal_items WHERE job=? AND status='completed'", (j["id"],)).fetchone()[0]
                if n % 5 == 0: state.emit(db, "batch_verified", j["id"], {"count": n, "checkpoint": True})
        next_phase = phase or j["phase"]
        if j["mode"] == "preview" and next_phase == "render":
            raise FactoryError("command", "preview_cannot_render", "Preview-only job cannot enter final rendering")
        target = "previewed" if j["mode"] == "preview" else "completed"
        pending = db.execute("SELECT count(*) FROM universal_items WHERE job=? AND status NOT IN (?, 'skipped')", (j["id"], target)).fetchone()[0]
        done = not pending and next_phase != "preflight"
        status = "cancelled" if j["status"] == "cancelling" else "completed" if done else "paused" if j["status"] == "paused" else "queued"
        db.execute("UPDATE universal_jobs SET status=?,phase=?,lease=NULL,expires=NULL,attempts=0 WHERE id=?", (status, next_phase, j["id"]))
        state.emit(db, "series_summary" if done else "job_progress", j["id"], summary(db, j["id"]))


def fail(state, job, detail, blocked=False):
    with state.transaction() as db:
        changed = db.execute("UPDATE universal_jobs SET status=?,diagnostic=?,attempts=attempts+1,lease=NULL,expires=NULL WHERE id=? AND lease=? AND expires>=?", ("blocked" if blocked else "failed", canonical(detail).decode(), job["id"], job["lease"], time.time())).rowcount
        if changed: state.emit(db, "final_error", job["id"], detail)