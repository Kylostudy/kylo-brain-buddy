#!/usr/bin/env python3
"""Fixed read-only inventory: no arbitrary paths, commands, or archive writes."""
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOTS = ("/var/brain/archive", "/opt/kylo-subject-factory", "/var/brain/factory-packages")


def collect():
    storage = []
    for root in ROOTS:
        if not Path(root).exists():
            storage.append({"root": root, "available": False})
            continue
        size = shutil.disk_usage(root)
        storage.append({"root": root, "available": True, "total_bytes": size.total, "used_bytes": size.used,
                        "free_bytes": size.free, "device": Path(root).stat().st_dev})
    status_path = Path("/opt/kylo-subject-factory/work/status.json")
    status = {}
    if status_path.is_file() and status_path.stat().st_size <= 5 * 1024 * 1024:
        raw = status_path.read_bytes()
        parsed = json.loads(raw)
        status = {k: parsed.get(k) for k in ("status", "current", "verified_count")}
        status["status_sha256"] = hashlib.sha256(raw).hexdigest()
    unit = ""
    try:
        units = subprocess.run(["/usr/bin/systemctl", "show", "kylo-subject-factory.service", "--property=ActiveState,SubState,ExecMainStatus,Result"], capture_output=True, timeout=10, check=False)
        unit = units.stdout.decode()[:2000]
    except (OSError, subprocess.SubprocessError) as exc:
        unit = f"systemctl unavailable: {exc}"
    return {"observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "storage": storage,
            "production": status, "unit": unit}


if __name__ == "__main__":
    print(json.dumps(collect()))