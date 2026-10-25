import json, os, stat, subprocess, sys, tempfile, unittest
from pathlib import Path

SCRIPT = (Path(__file__).parent / "prepare-exam-renderer.sh").read_text()
SNIPPET = SCRIPT.split("<<'PY'\n", 1)[1].split("\nPY\n", 1)[0]
OLD_IMG = "sha256:" + "a" * 64
NEW_IMG = "sha256:" + "b" * 64


def run(entries, docker_present):
    with tempfile.TemporaryDirectory() as d:
        etc = Path(d)
        (etc / "reviewed-renderers.json").write_text(json.dumps(entries))
        bin_dir = etc / "bin"
        bin_dir.mkdir()
        docker = bin_dir / "docker"
        docker.write_text("#!/bin/sh\nexit %d\n" % (0 if docker_present else 1))
        docker.chmod(docker.stat().st_mode | stat.S_IXUSR)
        env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ["PATH"])
        p = subprocess.run([sys.executable, "-c", SNIPPET, NEW_IMG],
                           capture_output=True, text=True, env=env, cwd=d)
        out = json.loads((etc / "reviewed-renderers.json").read_text())
        return p.returncode, out, p.stderr


class ExamRendererRecovery(unittest.TestCase):
    def test_missing_image_allows_recovery(self):
        code, out, _ = run({"exam-promo-profiles-v1": {"image": OLD_IMG, "reviewed": True,
                                                       "scenes": ["exam-promo-profiles-v1"]}},
                           docker_present=False)
        self.assertEqual(code, 0)
        self.assertEqual(out["exam-promo-profiles-v1"]["image"], NEW_IMG)

    def test_existing_image_conflict_rejected(self):
        code, out, err = run({"exam-promo-profiles-v1": {"image": OLD_IMG, "reviewed": True,
                                                         "scenes": ["exam-promo-profiles-v1"]}},
                             docker_present=True)
        self.assertNotEqual(code, 0)
        self.assertIn("immutable_renderer_conflict", err)
        self.assertEqual(out["exam-promo-profiles-v1"]["image"], OLD_IMG)

    def test_fresh_registration(self):
        code, out, _ = run({}, docker_present=False)
        self.assertEqual(code, 0)
        self.assertEqual(out["exam-promo-profiles-v1"]["image"], NEW_IMG)


if __name__ == "__main__":
    unittest.main()
