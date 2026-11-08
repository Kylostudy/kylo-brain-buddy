"""Reviewed, read-only validator overlay for the existing piggy continuation v2.

The image, scene, recipe identity and v1 behaviour remain immutable. No rendering,
state writes, network access or activation happens in this module.
"""
import os
from pathlib import Path
import stat

from storage import checksum

VALIDATOR_SHA256 = "88bb596298a47bcc46c13f1afa5f7e8fc54e8989c914b149e7e76d9b588b54f5"
BASE_VALIDATORS = {
    "contract.py": "509bd75ce42b1892cf4a1c177afa1e3c807a9fbafd3d453f735fb2583fb692c6",
    "piggy.py": "8f3d438f1bc7dbd687d996516c94fe1aa56ada484a1a295b4c745240356da033",
}


def validator_mounts(manifest, renderer, source=None):
    if (manifest.get("recipe_id") != "malacpersely-i18n-continuation"
            or manifest.get("version") != "v2"
            or manifest.get("renderer") != "piggy-bank-multilang-safe-v1"):
        return []
    if (renderer.get("reviewed") is not True
            or renderer.get("scenes") != ["piggy-bank-i18n-v1"]):
        raise ValueError("piggy_v2_validator_review_required")
    root = Path(__file__).resolve().parent
    candidate = Path(source) if source is not None else root / "piggy_i18n.py"
    for name, expected in {**BASE_VALIDATORS, "piggy_i18n.py": VALIDATOR_SHA256}.items():
        path = candidate if name == "piggy_i18n.py" else root / name
        info = path.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_mode & 0o022
                or (os.geteuid() == 0 and info.st_uid != 0)
                or checksum(path) != expected):
            raise ValueError("piggy_v2_validator_checksum_failed")
    return ["-v", str(candidate) + ":/app/validation/piggy_i18n.py:ro"]