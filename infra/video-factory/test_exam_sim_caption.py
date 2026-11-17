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
        for k, v in (("recipe_id", "ielts-cs-trial"), ("version", "v3"), ("renderer", "piggy-bank-multilang-safe-v1")):
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

    def test_v1_gets_only_caption_mount(self):
        self.assertEqual(len(c.caption_mounts(M, R)), 2)

    def test_v2_gets_layout_and_validator_overlays_readonly(self):
        m = c.caption_mounts({**M, "version": "v2"}, R)
        targets = [x.split(":", 1)[1] for x in m[1::2]]
        self.assertEqual(targets, ["/app/sim-src/Caption.tsx:ro", "/app/sim-src/KyloExamSimulatorMaster.tsx:ro",
                                   "/app/sim-src/Composition.tsx:ro", "/app/validation/exam_simulator.py:ro"])

    def test_v2_modified_overlay_rejected(self):
        d = Path(tempfile.mkdtemp())
        try:
            for n in ["exam_sim_caption_v2.tsx", *c.V2_OVERLAYS]:
                shutil.copy(SRC.parent / n, d / n); os.chmod(d / n, 0o644)
            c.caption_mounts({**M, "version": "v2"}, R, root=d)
            (d / "exam_sim_master_v2.tsx").write_text("x"); os.chmod(d / "exam_sim_master_v2.tsx", 0o644)
            with self.assertRaises(ValueError):
                c.caption_mounts({**M, "version": "v2"}, R, root=d)
        finally:
            shutil.rmtree(d)

    def test_v2_layout_measures_every_text_element_and_fails_closed(self):
        comp = (SRC.parent / "exam_sim_composition_v2.tsx").read_text()
        self.assertIn("[data-sim-text]", comp); self.assertIn("sim_unsafe_element", comp)
        master = (SRC.parent / "exam_sim_master_v2.tsx").read_text()
        self.assertEqual(master.count("data-sim-text"), 3)
        # Static geometry at full scale; downward slide-in only lowers the phone (it is also scaled down then).
        phone = dict(left=210, right=210 + 680, top=250, bottom=250 + 820 + 80)
        card = dict(left=140, right=940, top=400, bottom=400 + 640)
        for b in (phone, card):
            self.assertTrue(b["left"] >= 65 and b["right"] <= 950 and b["top"] >= 231 and b["bottom"] <= 1459, b)

    def test_fix_measures_inner_text_not_container(self):
        s = SRC.read_text()
        self.assertNotIn("el.scrollHeight", s)
        self.assertIn("txt.offsetHeight > height", s)
        self.assertIn("sim_caption_cannot_fit", s)


if __name__ == "__main__":
    unittest.main()
