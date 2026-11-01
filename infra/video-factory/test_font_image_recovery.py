"""Missing-image recovery only; no real Docker, renderer or production."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = (Path(__file__).parent / "prepare-font-renderer.sh").read_text()
OLD = "sha256:" + "a" * 64
NEW = "sha256:" + "b" * 64
NAME = "ielts-promo-fonts-v1"


class FontRecovery(unittest.TestCase):
    def run_recovery(self, old_image=OLD, inspect_ok=False, inventory_ok=True, listed=None, scenes=None):
        entry = {"image": old_image, "reviewed": True, "scenes": scenes or ["ielts-promo-v1"]}
        other = {"image": OLD, "reviewed": True, "scenes": ["exam-promo-profiles-safe-v4"]}
        before = {NAME: entry, "exam-promo-profiles-safe-v4": other}
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            p = root / "reviewed-renderers.json"
            p.write_text(json.dumps(before))
            docker = root / "docker"
            docker.write_text("#!/bin/sh\nif [ \"$2\" = inspect ]; then exit %d; fi\nprintf '%%s\\n' '%s'\nexit %d\n" % (0 if inspect_ok else 1, "\n".join(listed if listed is not None else [NEW]), 0 if inventory_ok else 1))
            docker.chmod(0o700)
            snippet = SCRIPT.split("<<'PY'\n", 1)[1].split("\nPY\n", 1)[0].replace("/etc/kylo-video-factory", d)
            result = subprocess.run([sys.executable, "-c", snippet, NEW], env={**os.environ, "PATH": d + os.pathsep + os.environ["PATH"]}, capture_output=True, text=True)
            return result, before, json.loads(p.read_text())

    def test_confirmed_missing_recovers_only_ielts(self):
        result, before, after = self.run_recovery()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(after[NAME], {**before[NAME], "image": NEW})
        self.assertEqual(after["exam-promo-profiles-safe-v4"], before["exam-promo-profiles-safe-v4"])

    def test_existing_image_never_replaced(self):
        result, before, after = self.run_recovery(inspect_ok=True)
        self.assertIn("immutable_renderer_conflict", result.stderr)
        self.assertEqual(before, after)

    def test_daemon_failure_preserves_registration(self):
        result, before, after = self.run_recovery(inventory_ok=False)
        self.assertIn("renderer_inventory_unavailable", result.stderr)
        self.assertEqual(before, after)

    def test_inspect_failure_but_listed_image_not_replaced(self):
        result, before, after = self.run_recovery(listed=[OLD, NEW])
        self.assertIn("renderer_probe_failed", result.stderr)
        self.assertEqual(before, after)

    def test_changed_scene_not_repaired(self):
        result, before, after = self.run_recovery(scenes=["wrong-scene"])
        self.assertIn("immutable_renderer_conflict", result.stderr)
        self.assertEqual(before, after)

    def test_identical_entry_is_idempotent(self):
        result, before, after = self.run_recovery(old_image=NEW, inventory_ok=False)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(before, after)

    def test_malformed_inventory_fails_closed(self):
        result, before, after = self.run_recovery(listed=["invalid output"])
        self.assertIn("renderer_inventory_unavailable", result.stderr)
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()