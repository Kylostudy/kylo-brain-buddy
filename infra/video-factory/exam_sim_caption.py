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
# v2 only: layout overlays (phone/card inside the safe zone, per-frame element check) and the
# v2-aware host validator replace their in-image copies read-only; v1 mounts are unchanged.
V2_OVERLAYS = {
    "exam_sim_master_v2.tsx": ("/app/sim-src/KyloExamSimulatorMaster.tsx", "1054b48ee83a204514ac8a0daed4c5945f5749e63d4f7ab4dc048d201f6809d3"),
    "exam_sim_composition_v2.tsx": ("/app/sim-src/Composition.tsx", "cfbe49b385340b81ec522a0bea1a944a8619b158806a84f51eeb1e85d2097fbb"),
    "exam_simulator.py": ("/app/validation/exam_simulator.py", "0c01023150dd97eb0279c14f36039cfc5d05e7abc751d483a018223294074fb4"),
}
# v3 only: phone/card lowered with shadow margin, per-frame check of the full visible box (incl. shadow).
V3_OVERLAYS = {
    "exam_sim_master_v3.tsx": ("/app/sim-src/KyloExamSimulatorMaster.tsx", "e271f27792b43c4281376ad67313d8087f68648d05945f8055a32b5a3891f447"),
    "exam_sim_composition_v3.tsx": ("/app/sim-src/Composition.tsx", "33fa1461fa36c23580e08699a34b8f5a010da862897bb6c61580e0071f1d8273"),
    "exam_simulator.py": ("/app/validation/exam_simulator.py", "0c01023150dd97eb0279c14f36039cfc5d05e7abc751d483a018223294074fb4"),
}
REVIEWED_IMAGE = "sha256:9cb5cbd097e27ceacdf16394115d75848c97f494b7634894c349fed0782845c6"


def _checked(path, digest):
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_mode & 0o022
            or (os.geteuid() == 0 and info.st_uid != 0) or checksum(path) != digest):
        raise ValueError("renderer_review_required")
    return path


def caption_mounts(manifest, renderer, source=None, root=None):
    version = manifest.get("version")
    if (manifest.get("recipe_id") != "vizsgaszimulator-hu-trial" or version not in ("v1", "v2", "v3")
            or manifest.get("renderer") != "exam-simulator-safe-v1"):
        return []
    if (renderer.get("reviewed") is not True or renderer.get("scenes") != ["exam-simulator-v1"]
            or renderer.get("image") != REVIEWED_IMAGE):
        raise ValueError("renderer_review_required")
    base = Path(root) if root is not None else Path(__file__).resolve().parent
    path = _checked(Path(source) if source is not None else base / "exam_sim_caption_v2.tsx", CAPTION_SHA256)
    mounts = ["-v", str(path) + ":/app/sim-src/Caption.tsx:ro"]
    if version == "v2":
        for name, (target, digest) in V2_OVERLAYS.items():
            mounts += ["-v", str(_checked(base / name, digest)) + ":" + target + ":ro"]
    if version == "v3":
        for name, (target, digest) in V3_OVERLAYS.items():
            mounts += ["-v", str(_checked(base / name, digest)) + ":" + target + ":ro"]
    return mounts
