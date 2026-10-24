#!/usr/bin/env python3
"""A completed production receipt must never trigger automatic re-production."""
import json
from pathlib import Path


def completed(path):
    try:
        if Path(path).stat().st_size > 5 * 1024 * 1024:
            return False
        state = json.loads(Path(path).read_text())
        return state.get("status") == "completed" and state.get("current") is None and type(state.get("verified_count")) is int and state["verified_count"] > 0
    except (OSError, ValueError, AttributeError):
        return False


if __name__ == "__main__":
    raise SystemExit(0 if completed("/opt/kylo-subject-factory/work/status.json") else 1)