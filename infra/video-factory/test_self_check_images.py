import subprocess
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from universal_runtime import self_check

V4 = "sha256:a4a7ff47aca59b14d1f4fd0c30119162249b07ff03f327ed34d77e0ddc07c89e"
IELTS = "sha256:" + "b" * 64


class SelfCheckImages(unittest.TestCase):
    def check(self, failure=None):
        config = {"renderers": {"ielts-promo-fonts-v1": {"reviewed": True, "image": IELTS}, "exam-promo-profiles-safe-v4": {"reviewed": True, "image": V4}}, "work_root": "/work", "archive_root": "/archive", "min_free_bytes": 1, "max_disk_fraction": 0.8}
        def docker(args, **kwargs):
            if failure and IELTS in args and failure in args:
                raise subprocess.CalledProcessError(125, args, stderr=b"never forward raw response")
            return SimpleNamespace(stdout=((args[-1] + "\n").encode() if "inspect" in args else b"ok\n"))
        with patch("universal_runtime.subprocess.run", side_effect=docker), patch("universal_runtime.shutil.disk_usage", return_value=SimpleNamespace(free=900, used=100, total=1000)):
            return self_check(config)

    def test_complete_check_includes_actual_v4_digest(self):
        result = self.check()
        self.assertTrue(result["ok"])
        self.assertEqual(len(result["checks"]), 4)
        self.assertEqual(result["checks"][1]["image"], V4)
        self.assertTrue(result["observed_at"].endswith("+00:00"))

    def test_failed_ielts_inspect_keeps_overall_red(self):
        result = self.check("inspect")
        self.assertFalse(result["ok"])
        self.assertEqual(result["checks"][0]["probe_stage"], "image_inspect")
        self.assertEqual(result["checks"][0]["returncode"], 125)
        self.assertTrue(result["checks"][1]["ok"])
        self.assertNotIn("never forward", str(result))

    def test_container_failure_not_reported_as_inspect_failure(self):
        result = self.check("run")
        self.assertFalse(result["ok"])
        self.assertEqual(result["checks"][0]["probe_stage"], "container_echo")


if __name__ == "__main__":
    unittest.main()