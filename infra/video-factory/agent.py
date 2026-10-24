#!/usr/bin/env python3
"""VPS-only manager. No dynamic code or Docker socket delegated to recipes."""
import fcntl
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import threading
import time
from client import Client
from contract import canonical
from state import State
from storage import LocalArchive, checksum, safe_path
from verify import verify_video


class Runner:
    def __init__(self, config, state):
        self.config, self.state = config, state
        self.archive = LocalArchive(config["archive_root"])

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
            job = self.state.claim()
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
                self.render(job)
            except Exception as e:
                allowed = {"low_disk", "archive_conflict", "media_checksum_failed", "one_time_extension_required", "archive_readback_failed"}
                code = str(e) if str(e) in allowed else "render_or_verification_failed"
                self.state.fail(job, code, blocked=code in {"low_disk", "one_time_extension_required"})
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
            raise ValueError("one_time_extension_required")
        for root in (self.config["work_root"], self.config["archive_root"]):
            usage = shutil.disk_usage(root)
            if usage.free < self.config["min_free_bytes"] or usage.used / usage.total > self.config["max_disk_fraction"]:
                raise ValueError("low_disk")
        recipe_root = safe_path(self.config["recipe_root"], manifest["recipe_id"] + "/" + manifest["version"])
        for media in manifest["files"]:
            path = safe_path(recipe_root, media["key"])
            if not path.is_file() or path.stat().st_size != media["bytes"] or checksum(path) != media["sha256"]:
                raise ValueError("media_checksum_failed")
        work = Path(self.config["work_root"]) / job["id"] / str(job["cursor"])
        work.mkdir(parents=True, exist_ok=True)
        # Only the renderer's scratch directory is writable by its unprivileged UID.
        os.chown(work, 65532, 65532)
        os.chmod(work, 0o700)
        request = work / "request.json"
        request.write_bytes(canonical({"manifest": manifest, "video": video}))
        os.chown(request, 65532, 65532)
        os.chmod(request, 0o600)
        # Recovered crash: verify existing output instead of re-rendering it.
        output = work / "output.mp4"
        if not output.exists():
            subprocess.run(["/usr/bin/docker", "run", "--rm", "--name", "kylo-video-factory-render",
                "--network", "none", "--cpus", str(self.config["cpus"]), "--memory", self.config["memory"],
                "--memory-swap", self.config["memory"], "--pids-limit", "256", "--read-only", "--cap-drop", "ALL",
                "--security-opt", "no-new-privileges", "--user", "65532:65532", "--shm-size", "512m",
                "--tmpfs", "/tmp:rw,size=512m", "-e", "HOME=/tmp", "-e", "XDG_CONFIG_HOME=/tmp/.config", "-e", "XDG_CACHE_HOME=/tmp/.cache",
                "-v", str(recipe_root) + ":/recipe:ro", "-v", str(work) + ":/work:rw",
                renderer["image"]], check=True, timeout=7200, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        media_receipt = verify_video(output, video)
        receipt = self.archive.save(key, output, media_receipt)
        self.state.finish_video(job, key, receipt)
        # Only this verified temporary render is removable; masters/recipes/archive stay.
        if self.archive.verify(receipt):
            output.unlink()


def main():
    config_path = Path("/etc/kylo-video-factory/config.json")
    config = json.loads(config_path.read_text())
    if config.get("schema_version") != 1 or not 1 <= config["cpus"] <= 2 or config["memory"] != "4g" or not 0 < config["max_disk_fraction"] <= 0.8 or config["min_free_bytes"] < 20 * 1024**3:
        raise RuntimeError("reviewed_resource_limits_required")
    secret_path = Path("/etc/kylo-video-factory/machine-secret")
    if secret_path.stat().st_mode & 0o077:
        raise RuntimeError("machine_secret_permissions")
    client = Client(config["kylogic_origin"], config["agent_id"], secret_path.read_text().strip())
    state = State(Path(config["work_root"]) / "state.sqlite3")
    runner = Runner(config, state)
    # Exclusive manager lock persists across process life, including network outages.
    with open(Path(config["work_root"]) / "manager.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        last_claim = 0
        while True:
            try:
                for event in state.pending():
                    ack = client.request("events", event)
                    if ack.get("acknowledged_event_id") == event["event_id"]:
                        state.acknowledge(event["event_id"])
                if time.time() - last_claim >= 20:
                    client.request("heartbeat", {"schema_version": 1, "agent_id": config["agent_id"], "takeover_approved": config["takeover_approved"], "pending_events": len(state.pending())})
                    response = client.request("claim", {"schema_version": 1, "capabilities": ["data-recipes-v1"], "batch_size": 5, "concurrency": 1})
                    command = response.get("command")
                    if command is not None:
                        state.apply(command)
                    last_claim = time.time()
            except Exception:
                # Do not log remote payloads, URLs or exception details.
                print("KyLogic connection or command unavailable; durable work preserved", flush=True)
            runner.run_one()
            time.sleep(random.uniform(5, 10))


if __name__ == "__main__":
    main()