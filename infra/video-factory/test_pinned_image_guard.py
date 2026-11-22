"""Legacy renderers are not rebuilt while their pinned image exists; no real Docker."""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from pinned_image_present import present

IMG = "sha256:" + "c" * 64
LEGACY = {"prepare-font-renderer.sh": ("ielts-promo-fonts-v1", "ielts-promo-v1"),
          "prepare-exam-renderer.sh": ("exam-promo-profiles-v1", "exam-promo-profiles-v1"),
          "prepare-exam-safe-renderer.sh": ("exam-promo-profiles-safe-v2", "exam-promo-profiles-safe-v2"),
          "prepare-exam-safe-v3-renderer.sh": ("exam-promo-profiles-safe-v3", "exam-promo-profiles-safe-v3")}


class Guard(unittest.TestCase):
    def check(self, entry, inspect_out=IMG, inspect_rc=0):
        with tempfile.TemporaryDirectory() as d:
            reg = Path(d) / "r.json"; reg.write_text(json.dumps({"ielts-promo-fonts-v1": entry}))
            docker = Path(d) / "docker"
            docker.write_text("#!/bin/sh\necho %s\nexit %d\n" % (inspect_out, inspect_rc)); docker.chmod(0o700)
            return present("ielts-promo-fonts-v1", "ielts-promo-v1", reg, str(docker))

    def test_present_pinned_image_skips_rebuild(self):
        self.assertTrue(self.check({"image": IMG, "reviewed": True, "scenes": ["ielts-promo-v1"]}))

    def test_missing_image_falls_through_to_recovery(self):
        self.assertFalse(self.check({"image": IMG, "reviewed": True, "scenes": ["ielts-promo-v1"]}, inspect_rc=1))

    def test_identity_mismatch_falls_through(self):
        self.assertFalse(self.check({"image": IMG, "reviewed": True, "scenes": ["ielts-promo-v1"]}, inspect_out="sha256:" + "d" * 64))

    def test_wrong_scene_or_unreviewed_falls_through(self):
        self.assertFalse(self.check({"image": IMG, "reviewed": True, "scenes": ["other"]}))
        self.assertFalse(self.check({"image": IMG, "reviewed": False, "scenes": ["ielts-promo-v1"]}))

    def test_guard_runs_before_any_build_in_each_legacy_script(self):
        for name, (renderer, scene) in LEGACY.items():
            s = (HERE / name).read_text()
            guard = s.index('python3 "$SRC/pinned_image_present.py" %s %s' % (renderer, scene))
            self.assertLess(guard, s.index("docker build"), name)
            self.assertLess(guard, s.index("reviewed-renderers.json"), name)

    def test_v4_and_newer_scripts_untouched(self):
        for name in ("prepare-exam-safe-v4-renderer.sh", "prepare-seven-series-renderer.sh", "prepare-piggy-renderer.sh"):
            self.assertNotIn("pinned_image_present", (HERE / name).read_text())


if __name__ == "__main__":
    unittest.main()
