import copy, hashlib, re, sys, unittest
from pathlib import Path

HERE = Path(__file__).parent
R = HERE / "exam-simulator-renderer"
sys.path.insert(0, str(R / "validation"))
import exam_simulator as es  # noqa: E402
import exam_audio  # noqa: E402

# Real KyLogic v4 timing from the cached Jessica narration (timing-hu.json).
FRAMES = [80, 80, 130, 119, 90, 94, 240]
SUBS = [(1, 300, 2157), (2, 2967, 4824), (3, 5633, 9162), (4, 9967, 13124), (6, 16933, 19254), (7, 20067, 22296), (7, 24167, 27510)]


def manifest():
    return {
        "recipe": "vizsgaszimulator-hu-trial", "version": "v1", "series": "other", "renderer": "exam-simulator-safe-v1",
        "start_series": False,
        "files": [{"key": k, "bytes": b, "sha256": s} for k, (s, b) in es.PINNED.items()],
        "videos": [{
            "video_id": "vizsgaszimulator-hu-v4", "language": "hu", "width": 1080, "height": 1920, "scene": "exam-simulator-v1",
            "text": dict(es.TEXT), "cta": dict(es.CTA), "screens": list(es.SCREENS), "audio": dict(es.AUDIO),
            "timing": {"fps": 30, "sceneFrames": list(FRAMES), "duration_ms": 27766,
                       "protected_windows_ms": [[13633, 16633]], "black_outro_start_ms": 24167},
            "subtitle": [{"scene": s, "start_ms": a, "end_ms": b, "text": t} for (s, a, b), (_, t) in zip(SUBS, es.CAPTIONS)],
        }],
    }


def errors(m):
    return es.diagnose(m)


class Contract(unittest.TestCase):
    def test_real_hu_timing_accepted(self):
        self.assertEqual(errors(manifest()), [])
        self.assertTrue(es.validate_trial(manifest()))

    def test_request_must_render_the_manifest_video(self):
        m = manifest()
        self.assertTrue(es.validate_request({"manifest": m, "video": m["videos"][0]}))
        other = copy.deepcopy(m["videos"][0]); other["video_id"] = "masik"
        with self.assertRaises(ValueError):
            es.validate_request({"manifest": m, "video": other})

    def test_bad_scene_frames_rejected(self):
        for bad in ([80] * 6, [80] * 8, [0, 80, 130, 119, 90, 94, 240], [80.0, 80, 130, 119, 90, 94, 240],
                    [16, 80, 130, 119, 90, 94, 240], [True, 80, 130, 119, 90, 94, 240], [400] * 7, "80"):
            m = manifest(); m["videos"][0]["timing"]["sceneFrames"] = bad
            self.assertTrue(any("sceneFrames" in e for e in errors(m)), bad)

    def test_duration_must_match_frames(self):
        m = manifest(); m["videos"][0]["timing"]["duration_ms"] = 30000
        self.assertTrue(any("duration_ms" in e for e in errors(m)))

    def test_line_outside_own_scene_rejected(self):
        m = manifest(); m["videos"][0]["subtitle"][0]["end_ms"] = 2700
        self.assertTrue(any("outside its own scene 1" in e for e in errors(m)))

    def test_silent_scene5_window_protected(self):
        m = manifest(); m["videos"][0]["timing"]["protected_windows_ms"] = [[13000, 16633]]
        self.assertTrue(any("protected_windows_ms" in e for e in errors(m)))

    def test_black_outro_order(self):
        m = manifest(); m["videos"][0]["subtitle"][6]["start_ms"] = 23000
        self.assertTrue(any("black outro" in e for e in errors(m)))
        m = manifest(); m["videos"][0]["timing"]["black_outro_start_ms"] = 23000
        self.assertTrue(any("black_outro_start_ms" in e for e in errors(m)))

    def test_unapproved_caption_rejected(self):
        m = manifest(); m["videos"][0]["subtitle"][2]["text"] = "Egyedülálló ajánlat!"
        self.assertTrue(any("approved scene 3" in e for e in errors(m)))

    def test_unsafe_path_rejected(self):
        for key in ("../etc/passwd", "screens/a.png", "/abs", "Screens/x"):
            m = manifest(); m["files"][0]["key"] = key
            self.assertTrue(any("unsafe path" in e for e in errors(m)), key)

    def test_checksum_and_size_pinned(self):
        m = manifest(); m["files"][4]["sha256"] = "0" * 64
        self.assertTrue(any("checksum/size" in e for e in errors(m)))
        m = manifest(); m["files"][0]["bytes"] += 1
        self.assertTrue(any("checksum/size" in e for e in errors(m)))
        m = manifest(); del m["files"][1]
        self.assertTrue(any("missing screens/magic-school-2-png" in e for e in errors(m)))

    def test_unknown_scene_rejected(self):
        m = manifest(); m["videos"][0]["scene"] = "piggy-bank-i18n-v1"
        self.assertTrue(any("unknown scene" in e for e in errors(m)))

    def test_other_language_rejected(self):
        m = manifest(); m["videos"][0]["language"] = "fr"
        self.assertTrue(any("only hu" in e for e in errors(m)))

    def test_multiple_outputs_rejected(self):
        m = manifest(); m["videos"].append(copy.deepcopy(m["videos"][0]))
        self.assertTrue(any("exactly one output" in e for e in errors(m)))

    def test_series_start_rejected(self):
        m = manifest(); m["start_series"] = True
        self.assertTrue(any("start_series" in e for e in errors(m)))
        m = manifest(); m["series"] = "vizsgaszimulator"
        self.assertTrue(any("series" in e for e in errors(m)))

    def test_all_problems_reported_together(self):
        m = manifest(); m["videos"][0]["language"] = "sr"; m["start_series"] = True; m["files"][0]["sha256"] = "1" * 64
        self.assertGreaterEqual(len(errors(m)), 3)

    def test_screens_must_be_the_four_pinned(self):
        m = manifest(); m["videos"][0]["screens"] = es.SCREENS[:3]
        self.assertTrue(any("screens" in e for e in errors(m)))


class Audio(unittest.TestCase):
    def test_graph_follows_real_scene_lengths(self):
        g = exam_audio.filter_graph(FRAMES, {"gain_db": 0})
        self.assertEqual(len(re.findall(r"\[w\d\]adelay", g)), 6)          # whoosh on six cuts
        self.assertIn("atrim=0:27.767", g)                                  # exact video length
        self.assertIn("sidechaincompress", g)                               # music ducked under VO
        self.assertIn("adelay=%d" % round(sum(FRAMES[:5]) / 30 * 1000 + 200), g)  # chime in scene 6
        self.assertIn("alimiter", g)

    def test_measure_pass_targets_minus_14(self):
        self.assertIn("loudnorm=I=-14.0", exam_audio.filter_graph(FRAMES))


class Release(unittest.TestCase):
    def test_renderer_checksums_and_allowlist(self):
        for line in (R / "SHA256SUMS").read_text().splitlines():
            sha, name = line.split("  ", 1)
            self.assertEqual(hashlib.sha256((R / name).read_bytes()).hexdigest(), sha, name)
        listed = {l.split("  ", 1)[1] for l in (R / "SHA256SUMS").read_text().splitlines()}
        on_disk = {str(p.relative_to(R)) for p in R.rglob("*") if p.is_file() and p.name != "SHA256SUMS" and "__pycache__" not in p.parts}
        self.assertEqual(listed, on_disk)
        self.assertIn('ALLOWED_EXTRA["exam-simulator-safe-v1"] = ["exam-simulator-v1"]', (HERE / "activate-manager.sh").read_text())

    def test_prepare_never_renders_or_registers_recipes(self):
        s = (HERE / "prepare-exam-simulator-renderer.sh").read_text()
        self.assertIn("immutable_renderer_conflict", s)
        self.assertNotIn("request.json", s)
        self.assertNotIn("register", s.lower())


if __name__ == "__main__":
    unittest.main()
