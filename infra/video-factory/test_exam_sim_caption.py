import os, shutil, tempfile, unittest
from pathlib import Path
import exam_sim_caption as c

M = {"recipe_id": "vizsgaszimulator-hu-trial", "version": "v1", "renderer": "exam-simulator-safe-v1"}
R = {"reviewed": True, "scenes": ["exam-simulator-v1"], "image": c.REVIEWED_IMAGE}
SRC = Path(__file__).resolve().parent / "exam_sim_caption_v2.tsx"


class CaptionOverlay(unittest.TestCase):
    def test_trial_gets_readonly_caption_mount(self):
        m = c.caption_mounts(M, R)
        self.assertEqual(m[0], "-v")
        self.assertTrue(m[1].endswith(":/app/sim-src/Caption.tsx:ro"))

    def test_other_recipes_untouched(self):
        for k, v in (("recipe_id", "ielts-cs-trial"), ("version", "v2"), ("renderer", "piggy-bank-multilang-safe-v1")):
            self.assertEqual(c.caption_mounts({**M, k: v}, R), [])

    def test_unreviewed_image_rejected(self):
        with self.assertRaises(ValueError):
            c.caption_mounts(M, {**R, "image": "sha256:" + "0" * 64})

    def test_modified_caption_rejected(self):
        d = tempfile.mkdtemp()
        try:
            p = Path(d) / "x.tsx"; p.write_bytes(SRC.read_bytes() + b"\n"); os.chmod(p, 0o644)
            with self.assertRaises(ValueError):
                c.caption_mounts(M, R, p)
            os.chmod(p, 0o666)
            with self.assertRaises(ValueError):
                c.caption_mounts(M, R, p)
        finally:
            shutil.rmtree(d)

    def test_fix_measures_inner_text_not_container(self):
        s = SRC.read_text()
        self.assertNotIn("el.scrollHeight", s)
        self.assertIn("txt.offsetHeight > height", s)
        self.assertIn("sim_caption_cannot_fit", s)


if __name__ == "__main__":
    unittest.main()
