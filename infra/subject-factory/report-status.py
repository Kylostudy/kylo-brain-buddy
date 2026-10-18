#!/usr/bin/env python3
"""Fixed, read-only host diagnostics sent over the existing protected heartbeat."""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request

MAX_BYTES = 12000
UNITS = ("kylo-subject-factory-install.service", "kylo-subject-factory.service")


def sanitize(text):
    # Never forward URLs, credentials or signed-link lines from build output.
    sensitive = re.compile(r"https?://|bearer\s|token|secret|password|authorization|signature|cookie|credential|api[_-]?key|sb_secret_|gh[pousr]_", re.I)
    return "\n".join("[sensitive line omitted]" if sensitive.search(line) else line
                     for line in text.splitlines())[-MAX_BYTES:]


def tail_file(filename):
    try:
        with open(filename, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - MAX_BYTES))
            return {"available": True, "bytes": size, "tail": sanitize(f.read(MAX_BYTES).decode("utf-8", "replace"))}
    except FileNotFoundError:
        return {"available": False, "error": "missing"}
    except OSError:
        return {"available": False, "error": "unreadable"}


def command(args):
    try:
        result = subprocess.run(args, capture_output=True, timeout=8, check=False)
        return sanitize(result.stdout.decode("utf-8", "replace"))
    except (OSError, subprocess.TimeoutExpired):
        return "diagnostic unavailable"


def collect():
    units = {}
    for unit in UNITS:
        units[unit] = command(["systemctl", "show", unit, "--no-pager",
                               "--property=LoadState,ActiveState,SubState,Result,ExecMainCode,ExecMainStatus"])
    return {
        "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "install_log": tail_file("/var/log/kylo-subject-factory-install.log"),
        "units": units,
        "install_journal": command(["journalctl", "-u", UNITS[0], "-n", "30", "--no-pager", "-o", "short-iso"]),
        "factory_journal": command(["journalctl", "-u", UNITS[1], "-n", "20", "--no-pager", "-o", "short-iso"]),
        "production_status": tail_file("/opt/kylo-subject-factory/work/status.json"),
    }


def load_config(filename):
    config = {}
    for line in Path(filename).read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() in ("BRAIN_URL", "WORKER_API_TOKEN", "WORKER_API_TOKEN_V2", "WORKER_ID"):
            config[key.strip()] = value.strip().strip("\"'")
    return config


def main():
    config = load_config(os.environ.get("WORKER_ENV_FILE", "/home/kylo/kylo-worker/worker/.env"))
    # A fixed destination prevents a corrupted config from exporting credentials.
    base = config.get("BRAIN_URL", "").rstrip("/")
    if base != "https://brain.kylosystems.com":
        raise RuntimeError("diagnostic destination not allowed")
    token = config.get("WORKER_API_TOKEN_V2") or config.get("WORKER_API_TOKEN")
    if not token:
        raise RuntimeError("diagnostic authentication unavailable")
    payload = {"workerId": config.get("WORKER_ID", "worker-1") + "-factory",
               "detail": {"subject_factory": collect()}}
    req = urllib.request.Request(base + "/api/public/worker/heartbeat",
                                 data=json.dumps(payload).encode(), method="POST",
                                 # Cloudflare blocks the default "Python-urllib" agent before the request reaches Brain.
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json",
                                          "User-Agent": "kylo-subject-factory-report/1.0"})
    # Do not follow redirects with the credential header.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    with urllib.request.build_opener(NoRedirect).open(req, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError("diagnostic report rejected")
    print("Subject factory diagnostics delivered")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Exception messages may contain request details; don't log them.
        print("Subject factory diagnostics failed; retry on next timer tick")
        raise SystemExit(1)