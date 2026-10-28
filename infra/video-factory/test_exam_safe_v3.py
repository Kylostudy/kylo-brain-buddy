import unittest
from pathlib import Path
R = Path(__file__).parent

class SafeV3(unittest.TestCase):
    def test_only_font_packages_added(self):
        old = (R / "exam-safe-renderer/Dockerfile").read_text().splitlines()
        new = (R / "exam-safe-v3-renderer/Dockerfile").read_text().splitlines()
        diff = [(a, b) for a, b in zip(old, new) if a != b]
        self.assertEqual(len(old), len(new))
        self.assertEqual(len(diff), 1)
        self.assertIn("fonts-noto-core fonts-noto-cjk", diff[0][1])
        for f in (R / "exam-safe-renderer").rglob("*"):
            if f.is_file() and f.name not in ("Dockerfile", "SHA256SUMS"):
                self.assertEqual(f.read_bytes(), (R / "exam-safe-v3-renderer" / f.relative_to(R / "exam-safe-renderer")).read_bytes())

    def test_v3_has_own_scene_and_v2_untouched(self):
        act = (R / "activate-manager.sh").read_text()
        self.assertIn('"exam-promo-profiles-safe-v3": ["exam-promo-profiles-safe-v3"]', act)
        self.assertIn('"exam-promo-profiles-safe-v2": ["exam-promo-profiles-safe-v2"]', act)
        prep = (R / "prepare-exam-safe-v3-renderer.sh").read_text()
        self.assertNotIn("safe-v2", prep)
        self.assertIn("immutable_renderer_conflict", prep)

if __name__ == "__main__":
    unittest.main()
