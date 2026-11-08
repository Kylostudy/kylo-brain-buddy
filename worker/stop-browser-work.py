#!/usr/bin/env python3
"""Retire only verified Kylo browser containers; never delete containers/data."""
import json
import re
import subprocess
import tempfile
from pathlib import Path

NON_BROWSER = {"archive_video", "receive_subject_factory_package"}

def kind(info):
    config = info.get("Config") or {}
    labels = config.get("Labels") or {}
    service = labels.get("com.docker.compose.service", "")
    if service in ("recorder-blue", "recorder-green") and config.get("Image") == "kylo-recorder:latest":
        return "recorder"
    env = dict(item.split("=", 1) for item in config.get("Env", []) if "=" in item)
    if config.get("Image") == "kylo-executor:latest" and env.get("SPEC_FILE") == "/job/spec.json" and re.fullmatch(r"[0-9a-f-]{36}", env.get("RUN_ID", "")):
        return "executor"
    return None

def stop_all(run=subprocess.run):
    def call(args):
        return run(["docker", *args], capture_output=True, text=True, check=True).stdout
    ids = call(["ps", "-aq"]).split()
    stopped = []
    for cid in ids:
        info = json.loads(call(["inspect", cid]))[0]
        category = kind(info)
        if category is None:
            continue
        if category == "executor":
            with tempfile.TemporaryDirectory(prefix="kylo-retire-") as tmp:
                destination = Path(tmp) / "spec.json"
                call(["cp", f"{cid}:/job/spec.json", str(destination)])
                spec = json.loads(destination.read_text())
            if (spec.get("brain_task") or {}).get("task_type") in NON_BROWSER:
                continue
        call(["update", "--restart=no", cid])
        if (info.get("State") or {}).get("Running"):
            call(["stop", "-t", "0", cid])
        stopped.append({"id": cid, "kind": category})
    return {"ok": True, "stopped": stopped}

if __name__ == "__main__":
    try:
        print(json.dumps(stop_all()))
    except Exception:
        print(json.dumps({"ok": False, "error": "browser_shutdown_not_verified"}))
        raise SystemExit(1)