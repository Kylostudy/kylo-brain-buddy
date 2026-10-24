#!/usr/bin/env python3
"""Missing --rm container after normal exit is success; Docker failures are not."""
import subprocess

NAME = "kylo-subject-factory"


def stop(run=subprocess.run):
    result = run(["/usr/bin/docker", "stop", "-t", "30", NAME], capture_output=True, timeout=45, check=False)
    if result.returncode == 0:
        return 0
    listing = run(["/usr/bin/docker", "ps", "-a", "--format", "{{.Names}}"], capture_output=True, timeout=10, check=False)
    if listing.returncode != 0 or NAME in listing.stdout.decode().splitlines():
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(stop())
    except (OSError, subprocess.TimeoutExpired):
        raise SystemExit(1)