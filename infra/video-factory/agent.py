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


def refresh_series_renderer(config, config_path=Path('/etc/kylo-video-factory/config.json'),
                            reviewed_path=Path('/etc/kylo-video-factory/reviewed-renderers.json')):
    """Refresh only the installed series binding, never resources, credentials or legacy entries."""
    import copy
    import re
    import seven_series as series
    disk = json.loads(config_path.read_text())
    reviewed = json.loads(reviewed_path.read_text())
    entry = disk.get('renderers', {}).get(series.RENDERER)
    if (not isinstance(entry, dict) or entry != reviewed.get(series.RENDERER)
            or entry.get('reviewed') is not True or entry.get('scenes') != series.SCENES):
        raise ValueError('seven_series_renderer_binding')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', str(entry.get('image', ''))):
        raise ValueError('seven_series_renderer_digest')
    old = config.get('renderers', {}).get(series.RENDERER)
    if old is not None and old != entry:
        raise ValueError('immutable_renderer_conflict')
    config.setdefault('renderers', {})[series.RENDERER] = copy.deepcopy(entry)


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
        body = {"at": int(time.time()), "job_id": job.get("id"), "cursor": cursor, "attempt": job.get("attempts"),
                "recipe_id": manifest.get("recipe_id"), "version": manifest.get("version"),
                "video_id": video.get("video_id"), "code": code, "detail": detail}
        tmp = root / (FAILURE_FILE + ".tmp")
        tmp.write_text(json.dumps(body, ensure_ascii=False, indent=1))
        os.replace(tmp, root / FAILURE_FILE)
        return body
    except Exception as e:
        print("render failure record unavailable (%s)" % type(e).__name__, flush=True)


def render_process(command, image, started, timeout=7200):
    """Observe the approved live container, not merely a successful Docker client spawn."""
    import re
    import tempfile
    deadline = time.monotonic() + timeout
    observed = False
    with tempfile.TemporaryDirectory(prefix="kylo-render-cid-") as cid_root:
        cid_file = Path(cid_root) / "container-id"
        bound_command = [*command[:2], "--cidfile", str(cid_file), *command[2:]]
        return _wait_render_process(bound_command, image, started, timeout, deadline, observed, cid_file)


def _wait_render_process(command, image, started, timeout, deadline, observed, cid_file):
    import re
    with subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE) as process:
        try:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(command, timeout)
                try:
                    _, stderr = process.communicate(timeout=min(1, remaining))
                    if process.returncode:
                        raise subprocess.CalledProcessError(process.returncode, command, stderr=stderr)
                    return
                except subprocess.TimeoutExpired:
                    if observed:
                        continue
                    try:
                        container_id = cid_file.read_text().strip()
                        if not re.fullmatch(r"[a-f0-9]{64}", container_id):
                            continue
                        probe = subprocess.check_output(
                            ["/usr/bin/docker", "inspect", "--format", "{{.State.Running}} {{.Image}} {{.Id}}",
                             container_id], text=True, stderr=subprocess.DEVNULL, timeout=2).strip().split()
                    except (OSError, subprocess.SubprocessError):
                        continue
                    if (len(probe) == 3 and probe[0] == "true" and probe[1] == image
                            and probe[2] == container_id):
                        started(probe[2])
                        observed = True
        except BaseException:
            process.kill()
            process.communicate()
            raise


class Runner:
    def __init__(self, config, state):
        self.config, self.state = config, state
        self.archive = LocalArchive(config["archive_root"], config.get("read_roots"))
        self.waiting = None

    def report_waiting(self, reason):
        if self.waiting != reason:
            if self.state.monitor_waiting(reason):
                self.waiting = reason

    def run_one(self):
        if not self.config.get("takeover_approved", False):
            self.report_waiting("takeover_not_approved")
            return
        # Shared lock must be adopted by every production renderer before takeover.
        with open(self.config["production_lock"], "a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                self.report_waiting("production_lock_busy")
                return
            active = subprocess.run(["/usr/bin/systemctl", "is-active", "--quiet", "kylo-subject-factory.service"], check=False)
            if active.returncode == 0:
                self.report_waiting("legacy_producer_active")
                return
            from universal_state import claim as claim_universal
            job = self.state.claim()
            if not job:
                job = claim_universal(self.state, int(time.time()))
            if not job:
                self.report_waiting(self.state.waiting_reason())
                return
            self.waiting = None
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
                stored = record_failure(self.config, job, code, detail)
                print("render failed: job=%s cursor=%s code=%s detail=%s" % (job.get("id"), job.get("cursor"), code, json.dumps(detail, ensure_ascii=False)), flush=True)
                report = None
                try:
                    from failure_report import build
                    from contract import digest
                    manifest = job.get("manifest") or {}
                    report = build(stored, {"id": job["id"], "recipe": job["recipe"], "version": job["version"],
                                   "attempts": job["attempts"], "recipe_sha256": digest(manifest)},
                                   self.config["agent_id"], [f["key"] for f in manifest.get("files", [])])
                except Exception as diagnostic_error:
                    print("failure report unavailable (%s)" % type(diagnostic_error).__name__, flush=True)
                self.state.fail(job, code, blocked=code in allowed, failure_report=report)
            finally:
                stop.set()
                thread.join(timeout=35)

    def render(self, job):
        manifest = job["manifest"]
        import seven_series
        is_series = seven_series.targeted(manifest)
        if is_series:
            refresh_series_renderer(self.config)
            from seven_series_state import before_render
            before_render(self.state, job, self.config)
        video = manifest["videos"][job["cursor"]]
        self.state.monitor_video(job, "preparing")
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
        import exam_sim_runtime
        exam_sim = exam_sim_runtime.targeted(manifest)
        if exam_sim:
            exam_sim_runtime.validate(manifest)
        request.write_bytes(canonical(exam_sim_runtime.request(manifest, video) if exam_sim else {"manifest": manifest, "video": video}))
        os.chmod(request, 0o644)
        # Recovered crash: verify existing output instead of re-rendering it.
        output = work / "output.mp4"
        if not output.exists():
            from piggy_v2_runtime import validator_mounts
            from exam_sim_caption import caption_mounts
            from seven_audio_runtime import audio_mounts
            validation_mounts = validator_mounts(manifest, renderer) + caption_mounts(manifest, renderer) + audio_mounts(manifest, renderer)
            docker_command = ["/usr/bin/docker", "run", "--rm", "--name", "kylo-video-factory-render",
                "--network", "none", "--cpus", str(self.config["cpus"]), "--memory", self.config["memory"],
                "--memory-swap", self.config["memory"], "--pids-limit", "256", "--read-only", "--cap-drop", "ALL",
                "--security-opt", "no-new-privileges", "--user", "65532:65532", "--shm-size", "512m",
                "--tmpfs", "/tmp:rw,size=512m", "-e", "HOME=/tmp", "-e", "XDG_CONFIG_HOME=/tmp/.config", "-e", "XDG_CACHE_HOME=/tmp/.cache",
                "-v", str(recipe_root) + ":/recipe:ro", "-v", str(request) + ":/request.json:ro", "-v", str(work) + ":/work:rw",
                *validation_mounts, renderer["image"]]
            if is_series:
                self.state.monitor_video(job, "ready")
                render_process(docker_command, renderer["image"],
                    lambda container_id: self.state.monitor_video(job, "rendering", container_id=container_id,
                                                                  image=renderer["image"], evidence="docker_running"))
            else:
                subprocess.run(docker_command, check=True, timeout=7200, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        self.state.monitor_video(job, "verifying")
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
        if exam_sim:
            # Only frozen-and-silent frames outside the protected windows are removed.
            final, cut = exam_sim_runtime.tight_cut(checked, video)
            media_receipt = verify_video(final, exam_sim_runtime.expected(video, cut["after_ms"]))
            media_receipt["tight_cut"] = cut
            if final != checked:
                checked.unlink()
                checked = final
        else:
            media_receipt = verify_video(checked, video)
            import seven_stories
            if is_series:
                from seven_series_media import verify as verify_series
                media_receipt["seven_stories"] = verify_series(checked, safe_path(recipe_root, video["audio"]["vo"]), work / "layout.jsonl", video)
            elif seven_stories.targeted(manifest):
                from seven_media import verify as verify_seven
                if manifest["version"] == "v2":
                    from seven_media_v2 import verify as verify_seven
                media_receipt["seven_stories"] = verify_seven(checked, safe_path(recipe_root, video["audio"]["vo"]), work / "layout.jsonl", video)
        self.state.monitor_video(job, "archiving")
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
        from monitoring import Transport
        transport = Transport(state, client, config["agent_id"], config["takeover_approved"])
        transport.start()
        last_claim = 0
        while True:
            command = None
            phase = 'events'
            try:
                if time.time() - last_claim >= 20:
                    phase = 'claim'
                    response = client.request("claim", {"schema_version": 1, "capabilities": ["data-recipes-v1", "verified-inputs-v1", "ielts-continuation-v1", "partial-continuation-v1", "recipe-font-v1", "universal-exam-v2", "series-run-v2", "layout-qa-v2", "seven-stories-hu-v1", "seven-stories-hu-caption-v2", "seven-stories-i18n-v1"], "batch_size": 5, "concurrency": 1})
                    command = response.get("command")
                    if command is not None:
                        from recipe_runtime import validate_command
                        phase = 'validate_command'
                        validate_command(command)
                        if command["operation"] == "register_recipe":
                            phase = 'prepare_inputs'
                            inputs.prepare(command["payload"])
                        phase = 'apply_command'
                        state.apply(command)
                        if command["operation"] == "self_check":
                            from seven_series_preflight import run as series_preflight
                            from seven_series_state import record
                            refresh_series_renderer(config, config_path)
                            record(state, series_preflight(config, state))
                        if command["operation"] == "register_recipe":
                            phase = 'self_check'
                            import seven_stories
                            import seven_series
                            if seven_series.targeted(command["payload"]):
                                # Only the explicit aggregate self_check can authorize the full set.
                                check_result = {"ok": False, "registered": True, "aggregate_self_check_required": True, "contract_id": seven_series.CONTRACT_ID}
                            elif seven_stories.targeted(command["payload"]):
                                from seven_preflight import run as seven_preflight
                                check_result = seven_preflight(config["recipe_root"], config_path, registered=True, version=command["payload"]["version"])
                                target = Path(config["work_root"]).parent / "seven-stories-preflight.json"
                                temp = target.with_suffix(".tmp")
                                temp.write_bytes(canonical(check_result))
                                os.chmod(temp, 0o600)
                                os.replace(temp, target)
                            else:
                                check_result = self_check(config, command["payload"])
                            with state.transaction() as db:
                                state.emit(db, "self_check", command["delivery_id"], check_result)
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