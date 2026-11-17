"""Reviewed, read-only caption-fit overlay for the existing exam-simulator-safe-v1 image.

The image digest, renderer name, recipe identity and validator stay unchanged; only the
bundled-at-render-time Caption.tsx is replaced by a checksum-pinned host copy, because the
original measured container scrollHeight (inflated by glyph overflow) and every caption
failed with sim_caption_cannot_fit. No rendering, state writes or network happen here.
"""
import os
import stat
from pathlib import Path

from storage import checksum

CAPTION_SHA256 = "c2f8e1a243bcfd40da665db7c48d14b0fb4744526bee1d694596e044a467c53c"
REVIEWED_IMAGE = "sha256:9cb5cbd097e27ceacdf16394115d75848c97f494b7634894c349fed0782845c6"


def caption_mounts(manifest, renderer, source=None):
    if (manifest.get("recipe_id") != "vizsgaszimulator-hu-trial" or manifest.get("version") != "v1"
            or manifest.get("renderer") != "exam-simulator-safe-v1"):
        return []
    if (renderer.get("reviewed") is not True or renderer.get("scenes") != ["exam-simulator-v1"]
            or renderer.get("image") != REVIEWED_IMAGE):
        raise ValueError("renderer_review_required")
    path = Path(source) if source is not None else Path(__file__).resolve().parent / "exam_sim_caption_v2.tsx"
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_mode & 0o022
            or (os.geteuid() == 0 and info.st_uid != 0) or checksum(path) != CAPTION_SHA256):
        raise ValueError("renderer_review_required")
    return ["-v", str(path) + ":/app/sim-src/Caption.tsx:ro"]
