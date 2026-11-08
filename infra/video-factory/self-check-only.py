#!/usr/bin/env python3
"""One-shot host check and signed event delivery; never claims or executes jobs."""
import json
import os
from pathlib import Path
from client import Client
from state import State
from universal_runtime import self_check


def run(config, state, client, check=self_check):
    result = check(config)
    with state.transaction() as db:
        state.emit(db, "self_check", config["agent_id"], result)
        row = db.execute("SELECT id,body FROM outbox ORDER BY rowid DESC LIMIT 1").fetchone()
        event = json.loads(row["body"])
    acknowledgement = client.request("events", event)
    delivered = acknowledgement.get("acknowledged_event_id") == event["event_id"]
    if delivered:
        state.acknowledge(event["event_id"])
    return {**result, "event_id": event["event_id"], "kylogic_acknowledged": delivered}


def main():
    config = json.loads(Path("/etc/kylo-video-factory/config.json").read_text())
    secret_path = Path("/etc/kylo-video-factory/machine-secret")
    if secret_path.stat().st_mode & 0o077:
        raise RuntimeError("machine_secret_permissions")
    state = State(Path(config["work_root"]) / "state.sqlite3")
    client = Client(config["kylogic_origin"], config["agent_id"], secret_path.read_text().strip())
    result = run(config, state, client)
    target = Path("/var/lib/kylo-video-factory/self-check-only.json")
    temp = target.with_suffix(".tmp")
    temp.write_text(json.dumps(result, indent=2))
    os.chmod(temp, 0o600)
    os.replace(temp, target)
    print(json.dumps(result), flush=True)
    return 0 if result["ok"] and result["kylogic_acknowledged"] else 3


if __name__ == "__main__":
    raise SystemExit(main())