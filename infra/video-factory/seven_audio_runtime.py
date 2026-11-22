"""Read-only audio-check overlay for the exact seven reviewed Hungarian trials."""
import os
import stat
from pathlib import Path

import seven_stories as seven
from storage import checksum

REVIEWED_IMAGE = "sha256:2fad84eb73bfd8938228f09bb52139001e667c445d80a8a93aab19d035acfddb"
OVERLAYS = {
    "seven_audio.py": ("/app/validation/seven_audio.py", "c8d76d3d49c088285324215f19564d91bd4f429525a33aa4cc31011cac454eec"),
    "seven_audio_index.ts": ("/app/seven-src/index.ts", "64bb77c3a4c70757e12250e5267fb9c12c3643bc0f61c5e3311d16a0579ee38b"),
}


def audio_mounts(manifest, renderer, root=None):
    if not seven.targeted(manifest):
        return []
    seven.validate(manifest)
    if (renderer.get("image") != REVIEWED_IMAGE or renderer.get("reviewed") is not True
            or renderer.get("scenes") != seven.SCENES):
        raise ValueError("renderer_review_required")
    base = Path(root) if root is not None else Path(__file__).resolve().parent
    mounts = []
    for name, (target, digest) in OVERLAYS.items():
        path = base / name
        try:
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_mode & 0o022
                    or (os.geteuid() == 0 and info.st_uid != 0) or checksum(path) != digest):
                raise ValueError("renderer_review_required")
        except OSError:
            raise ValueError("renderer_review_required") from None
        mounts += ["-v", str(path) + ":" + target + ":ro"]
    return mounts