#!/usr/bin/env python3
"""VPS-only manager. No dynamic code or Docker socket delegated to recipes."""
import fcntl
import json
import os
from pathlib import Path
import random
import stat
import shutil
import subprocess
import threading
import time
from client import Client, RequestError
from contract import canonical
from state import State
from storage import LocalArchive, checksum, safe_path
from verify import verify_video
from inputs import Inputs, readable_inputs


FAILURE_FILE = "last-render-failure.json"


def failure_detail(exc):
    """Bounded diagnostic: exception class, message, failing code line and renderer stderr tail."""
    import traceback
    frames = traceback.extract_tb(exc.__traceback__)[-3:]
    detail = {
        "type": type(exc).__name__,
        "message": str(exc)[:500],
        "where": ["%s:%s %s" % (os.path.basename(f.filename), f.lineno, f.name) for f in frames],
    }
    filename = getattr(exc, "filename", None)
    if filename:
        detail["path"] = str(filename)[:400]
    if isinstance(exc, subprocess.CalledProcessError):
        detail["returncode"] = exc.returncode
        err = exc.stderr or b""
        if isinstance(err, bytes):
            err = err.decode("utf-8", "replace")
        detail["stderr_tail"] = err[-4000:]
    return detail


def record_failure(config, job, code, detail):
    try:
        root = Path(config["work_root"]).parent
        manifest = job.get("manifest") or {}
        videos = manifest.get("videos") or []
        cursor = job.get("cursor", 0)
        video = videos[cursor] if isinstance(cursor, int) and 0 <= cursor < len(videos) else {}
        body = {"at": int(time.time()), "job_id": job.get("id"), "cursor": cursor,
                "recipe_id": manifest.get("recipe_id"), "version": manifest.get("version"),
                "video_id": video.get("video_id"), "code": code, "detail": detail}
        tmp = root / (FAILURE_FILE + ".tmp")
        tmp.write_text(json.dumps(body, ensure_ascii=False, indent=1))
        os.replace(tmp, root / FAILURE_FILE)
    except Exception as e:
        print("render failure record unavailable (%s)" % type(e).__name__, flush=True)


class Runner:
    def __init__(self, config, state):
        self.config, self.state = config, state
        self.archive = LocalArchive(config["archive_root"], config.get("read_roots"))

    def run_one(self):
        if not self.config.get("takeover_approved", False):
            return
        # Shared lock must be adopted by every production renderer before takeover.
        with open(self.config["production_lock"], "a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return
            active = subprocess.run(["/usr/bin/systemctl", "is-active", "--quiet", "kylo-subject-factory.service"], check=False)
            if active.returncode == 0:
                return
            from universal_state import claim as claim_universal
            job = self.state.claim()
            if not job:
                job = claim_universal(self.state, int(time.time()))
            if not job:
                return
            stop = threading.Event()
            def renew():
                while not stop.wait(30):
                    if not self.state.heartbeat(job["id"], job["lease"]):
                        return
            thread = threading.Thread(target=renew, daemon=True)
            thread.start()
            try:
                if job.get("universal"):
                    from universal_runtime import run
                    run(self.config, self.state, self.archive, job)
                else:
                    self.render(job)
            except Exception as e:
                allowed = {"low_disk", "archive_conflict", "media_checksum_failed", "renderer_review_required", "archive_readback_failed", "unsafe_render_output"}
                code = str(e) if str(e) in allowed else "render_or_verification_failed"
                # Persist a bounded, local-only cause so a generic code is never the only trace.
                detail = failure_detail(e)
                record_failure(self.config, job, code, detail)
                print("render failed: job=%s cursor=%s code=%s detail=%s" % (job.get("id"), job.get("cursor"), code, json.dumps(detail, ensure_ascii=False)), flush=True)
                self.state.fail(job, code, blocked=code in allowed)
            finally:
                stop.set()
                thread.join(timeout=35)

    def render(self, job):
        manifest = job["manifest"]
        video = manifest["videos"][job["cursor"]]
        key = f'{manifest["recipe_id"]}/{manifest["version"]}/{video["video_id"]}'
        old = self.state.output(key)
        if old:
            if not self.archive.verify(old):
                raise ValueError("archive_readback_failed")
            self.state.finish_video(job, key, old)
            return
        # Renderer configuration is root-reviewed local configuration, never remote recipe data.
        renderer = self.config.get("renderers", {}).get(manifest["renderer"])
        if not renderer or not renderer.get("reviewed") or not renderer.get("image", "").startswith("sha256:") or video["scene"] not in renderer.get("scenes", []):
            raise ValueError("renderer_review_required")
        for root in (self.config["work_root"], self.config["archive_root"]):
            usage = shutil.disk_usage(root)
            if usage.free < self.config["min_free_bytes"] or usage.used / usage.total > self.config["max_disk_fraction"]:
                raise ValueError("low_disk")
        recipe_root = safe_path(self.config["recipe_root"], manifest["recipe_id"] + "/" + manifest["version"])
        # Includes recipes registered before the permission fix; no re-download.
        readable_inputs(recipe_root, manifest["files"])
        for media in manifest["files"]:
            path = safe_path(recipe_root, media["key"])
            if not path.is_file() or path.stat().st_size != media["bytes"] or checksum(path) != media["sha256"]:
                raise ValueError("media_checksum_failed")
        work = Path(self.config["work_root"]) / job["id"] / str(job["cursor"])
        work.mkdir(parents=True, exist_ok=True)
        # Only the renderer's scratch directory is writable by its unprivileged UID.
        os.chown(work, 65532, 65532)
        os.chmod(work, 0o700)
        request = work.parent / (str(job["cursor"]) + ".request.json")
        request.write_bytes(canonical({"manifest": manifest, "video": video}))
        os.chmod(request, 0o644)
        # Recovered crash: verify existing output instead of re-rendering it.
        output = work / "output.mp4"
        if not output.exists():
            subprocess.run(["/usr/bin/docker", "run", "--rm", "--name", "kylo-video-factory-render",
                "--network", "none", "--cpus", str(self.config["cpus"]), "--memory", self.config["memory"],
                "--memory-swap", self.config["memory"], "--pids-limit", "256", "--read-only", "--cap-drop", "ALL",
                "--security-opt", "no-new-privileges", "--user", "65532:65532", "--shm-size", "512m",
                "--tmpfs", "/tmp:rw,size=512m", "-e", "HOME=/tmp", "-e", "XDG_CONFIG_HOME=/tmp/.config", "-e", "XDG_CACHE_HOME=/tmp/.cache",
                "-v", str(recipe_root) + ":/recipe:ro", "-v", str(request) + ":/request.json:ro", "-v", str(work) + ":/work:rw",
                renderer["image"]], check=True, timeout=7200, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        # Renderer is gone; open without symlink following and copy to manager-only scratch.
        fd = os.open(output, os.O_RDONLY | os.O_NOFOLLOW)
        checked = work.parent / (str(job["cursor"]) + ".checked.mp4")
        os.chmod(work.parent, 0o700)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError("unsafe_render_output")
            with os.fdopen(fd, "rb", closefd=False) as r, checked.open("wb") as w:
                shutil.copyfileobj(r, w)
                w.flush()
                os.fsync(w.fileno())
        finally:
            os.close(fd)
        media_receipt = verify_video(checked, video)
        receipt = self.archive.save(key, checked, media_receipt)
        self.state.finish_video(job, key, receipt)
        # Only this verified temporary render is removable; masters/recipes/archive stay.
        if self.archive.verify(receipt):
            output.unlink()
            checked.unlink()


def main():
    config_path = Path("/etc/kylo-video-factory/config.json")
    config = json.loads(config_path.read_text())
    if config.get("schema_version") != 1 or not 1 <= config["cpus"] <= 2 or config["memory"] != "4g" or not 0 < config["max_disk_fraction"] <= 0.8 or config["min_free_bytes"] < 20 * 1024**3:
        raise RuntimeError("reviewed_resource_limits_required")
    secret_path = Path("/etc/kylo-video-factory/machine-secret")
    if secret_path.stat().st_mode & 0o077:
        raise RuntimeError("machine_secret_permissions")
    secret = secret_path.read_text().strip()
    client = Client(config["kylogic_origin"], config["agent_id"], secret)
    # Only a short one-way fingerprint and length are printed, never the secret itself.
    import hashlib
    print("manager start: agent_id=%s origin=%s secret_len=%d secret_sha256_8=%s takeover=%s renderers=%s" % (
        config["agent_id"], config["kylogic_origin"], len(secret), hashlib.sha256(secret.encode()).hexdigest()[:8],
        config.get("takeover_approved"), ",".join(sorted(config.get("renderers", {})))), flush=True)
    state = State(Path(config["work_root"]) / "state.sqlite3", LocalArchive(config["archive_root"], config.get("read_roots")))
    runner = Runner(config, state)
    inputs = Inputs(config["recipe_root"], client, runner.archive)
    from universal_runtime import self_check
    with state.transaction() as db:
        state.emit(db, "self_check", config["agent_id"], self_check(config))
    # Exclusive manager lock persists across process life, including network outages.
    with open(Path(config["work_root"]) / "manager.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        last_claim = 0
        while True:
            command = None
            phase = 'events'
            try:
                for event in state.pending():
                    ack = client.request("events", event)
                    if ack.get("acknowledged_event_id") == event["event_id"]:
                        state.acknowledge(event["event_id"])
                if time.time() - last_claim >= 20:
                    phase = 'heartbeat'
                    client.request("heartbeat", {"schema_version": 1, "agent_id": config["agent_id"], "takeover_approved": config["takeover_approved"], "pending_events": len(state.pending())})
                    phase = 'claim'
                    response = client.request("claim", {"schema_version": 1, "capabilities": ["data-recipes-v1", "verified-inputs-v1", "ielts-continuation-v1", "partial-continuation-v1", "recipe-font-v1", "universal-exam-v2", "series-run-v2", "layout-qa-v2"], "batch_size": 5, "concurrency": 1})
                    command = response.get("command")
                    if command is not None:
                        from contract import validate_command
                        phase = 'validate_command'
                        validate_command(command)
                        if command["operation"] == "register_recipe":
                            phase = 'prepare_inputs'
                            inputs.prepare(command["payload"])
                        phase = 'apply_command'
                        state.apply(command)
                        if command["operation"] == "register_recipe":
                            phase = 'self_check'
                            with state.transaction() as db:
                                state.emit(db, "self_check", command["delivery_id"], self_check(config, command["payload"]))
                    last_claim = time.time()
            except Exception as e:
                # Only the error class / HTTP status / own error code; never payloads or bodies.
                import urllib.error
                if isinstance(e, RequestError):
                    reason = e.code
                    print('KyLogic request failed: operation=%s http=%d reason=%s; durable work preserved' % (e.operation, e.status, e.code), flush=True)
                elif isinstance(e, urllib.error.HTTPError):
                    reason = "http_%d" % e.code
                elif isinstance(e, ValueError) and str(e).startswith("completed_video_missing:"):
                    from contract import object_key
                    parts = str(e).split(":", 2)
                    try:
                        if len(parts) != 3 or parts[1] not in {"factory", "brain-archive"}:
                            raise ValueError("invalid_missing_file_detail")
                        object_key(parts[2])
                        reason = str(e)
                    except ValueError:
                        reason = "invalid_missing_file_detail"
                elif isinstance(e, ValueError) and str(e).replace("_", "").isalnum() and len(str(e)) < 60:
                    reason = str(e)
                else:
                    reason = type(e).__name__
                if command is not None:
                    from universal import FactoryError, redact
                    detail = e.result if isinstance(e, FactoryError) else {"stage": "command", "code": reason, "message": type(e).__name__, "log_tail": []}
                    detail["message"] = " ".join(redact(detail["message"], (secret,)))
                    state.reject(command, reason, detail)
                if not isinstance(e, RequestError):
                    print("KyLogic connection or command unavailable (stage=%s reason=%s); durable work preserved" % (phase, reason), flush=True)
            runner.run_one()
            time.sleep(random.uniform(5, 10))


if __name__ == "__main__":
    main()