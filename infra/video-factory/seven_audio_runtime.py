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
CAPTION_V2_OVERLAYS = {
    "seven_audio.py": OVERLAYS["seven_audio.py"],
    "seven_caption_index_v2.ts": ("/app/seven-src/index.ts", "c92289a98271498f9fcb7bc442241e30d737202637d0839c845738570cc843f4"),
    "seven_caption_timing_v2.ts": ("/app/seven-src/timing.ts", "09293de0233b91e308b559280149f7fc1459cb88b58682b8b7af658bf207b75e"),
    "seven_caption_v2.py": ("/app/validation/seven_caption_v2.py", "0b8f24f4325a8b37ea3790fad28223662f47381c6c11bf99e1d6a53a1e8af01c"),
}


def audio_mounts(manifest, renderer, root=None):
    if not seven.targeted(manifest):
        return []
    from recipe_runtime import validate_recipe
    validate_recipe(manifest)
    if (renderer.get("image") != REVIEWED_IMAGE or renderer.get("reviewed") is not True
            or renderer.get("scenes") != seven.SCENES):
        raise ValueError("renderer_review_required")
    base = Path(root) if root is not None else Path(__file__).resolve().parent
    mounts = []
    overlays = CAPTION_V2_OVERLAYS if manifest["version"] == "v2" else OVERLAYS
    for name, (target, digest) in overlays.items():
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