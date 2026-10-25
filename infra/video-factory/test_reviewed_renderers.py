import json, subprocess, sys, tempfile, unittest
from pathlib import Path

SCRIPT = (Path(__file__).parent / "activate-manager.sh").read_text()
SNIPPET = SCRIPT.split("<<'PY'\n", 1)[1].split("\nPY\n", 1)[0]
IMG = "sha256:" + "a" * 64


def run(extra):
    with tempfile.TemporaryDirectory() as d:
        etc = Path(d)
        (etc / "config.json").write_text(json.dumps({"agent_id": "factory-finnish-vps-1",
            "kylogic_origin": "https://yqhipzwmgpopelfcenie.supabase.co/functions/v1/video-factory"}))
        (etc / "ielts-trial.json").write_text(json.dumps({"renderers": {"ielts-promo-v1": {"image": IMG, "reviewed": True, "scenes": ["ielts-promo-v1"]}}}))
        (etc / "reviewed-renderers.json").write_text(json.dumps(extra))
        p = subprocess.run([sys.executable, "-c", SNIPPET, str(etc)], capture_output=True, text=True)
        cfg = json.loads((etc / "config.json").read_text())
        return p.returncode, cfg, p.stderr


class ReviewedRenderers(unittest.TestCase):
    def test_exam_renderer_accepted(self):
        code, cfg, _ = run({"ielts-promo-fonts-v1": {"image": IMG, "reviewed": True, "scenes": ["ielts-promo-v1"]},
                            "exam-promo-profiles-v1": {"image": IMG, "reviewed": True, "scenes": ["exam-promo-profiles-v1"]}})
        self.assertEqual(code, 0)
        self.assertEqual(cfg["renderers"]["exam-promo-profiles-v1"]["scenes"], ["exam-promo-profiles-v1"])

    def test_exam_renderer_wrong_scene_rejected(self):
        code, cfg, err = run({"exam-promo-profiles-v1": {"image": IMG, "reviewed": True, "scenes": ["ielts-promo-v1"]}})
        self.assertNotEqual(code, 0)
        self.assertNotIn("renderers", cfg)

    def test_unknown_renderer_rejected(self):
        code, _, _ = run({"uploaded-renderer": {"image": IMG, "reviewed": True, "scenes": ["x"]}})
        self.assertNotEqual(code, 0)

    def test_unpinned_image_rejected(self):
        code, _, _ = run({"exam-promo-profiles-v1": {"image": "latest", "reviewed": True, "scenes": ["exam-promo-profiles-v1"]}})
        self.assertNotEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
