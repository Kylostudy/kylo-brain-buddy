"""Exit 0 only when a legacy renderer's pinned reviewed image is still present locally.

Legacy prepare scripts call this before building. Rebuilding an already-pinned
renderer moves its tag to a fresh (non-reproducible) image ID and can drop the
pinned image, so the running factory briefly or permanently references a
missing digest. Any doubt (missing entry, daemon error, mismatch) exits 1 and
the script falls through to its unchanged build + proven-absence recovery.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

REGISTRY = Path("/etc/kylo-video-factory/reviewed-renderers.json")


def present(name, scene, registry=REGISTRY, docker="docker"):
    try:
        entry = json.loads(Path(registry).read_text()).get(name)
    except Exception:
        return False
    if not isinstance(entry, dict) or entry.get("reviewed") is not True or entry.get("scenes") != [scene]:
        return False
    image = str(entry.get("image", ""))
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
        return False
    try:
        r = subprocess.run([docker, "image", "inspect", "--format", "{{.Id}}", image], capture_output=True, text=True, timeout=30)
    except Exception:
        return False
    return r.returncode == 0 and r.stdout.strip() == image


if __name__ == "__main__":
    sys.exit(0 if present(sys.argv[1], sys.argv[2]) else 1)
