import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import seven_stories as seven
import seven_media as v1
import seven_media_v2 as v2
from seven_audio_runtime import audio_mounts, CAPTION_V2_OVERLAYS, REVIEWED_IMAGE


def layout_rows(video, corrected=True):
    rows = []
    scene, offset = 0, 0
    for frame in range(sum(video["timeline"]["sceneFrames"])):
        while frame >= offset + video["timeline"]["sceneFrames"][scene]:
            offset += video["timeline"]["sceneFrames"][scene]
            scene += 1
        texts = []
        subtitle = next((s for s in video["timeline"]["subtitles"]
                         if s["start_ms"] <= frame * 1000 / 30 < s["end_ms"]), None)
        if subtitle:
            text = subtitle["text"]
            if corrected and text in ("Kylo pont study.", "Kylo pont study"):
                text = "kylo.study"
            texts.append(text.replace("Kylóban", "Kylo-ban").replace("Kylóval", "Kylo-val").replace("Kájló", "Kylo"))
        if scene == 5:
            texts.append("Próbáld ki ingyen 14 napig!")
        if scene == 6:
            texts += ["kylo.study", "A te AI magántanárod"]
        records = [{"kind": "object", "left": 100, "right": 400, "top": 300, "bottom": 800}]
        for i, text in enumerate(texts):
            records.append({"kind": "text", "text": text, "left": 100, "right": 900,
                            "top": 900 + i * 100, "bottom": 950 + i * 100})
        rows.append({"frame": frame, "story": video["story"], "scene": scene, "records": records})
    return rows


class MediaV2Tests(unittest.TestCase):
    def check_rows(self, rows, video, verifier=v2.verify_layout):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "layout.jsonl"
            path.write_text("\n".join(json.dumps(row) for row in rows))
            return verifier(path, video)

    def test_all_seven_complete_v2_layouts_accept_corrected_caption(self):
        for story in seven.STORIES:
            with self.subTest(story=story):
                video = seven.template(story)["videos"][0]
                before = copy.deepcopy(video)
                rows = layout_rows(video)
                self.assertTrue(any(r.get("text") == "kylo.study" for row in rows for r in row["records"]))
                result = self.check_rows(rows, video)
                self.assertEqual(result["frames"], sum(video["timeline"]["sceneFrames"]))
                self.assertTrue(result["all_frames_checked"])
                self.assertEqual(video, before)
                with self.assertRaisesRegex(ValueError, "seven_caption_missing"):
                    self.check_rows(rows, video, v1.verify_layout)

    def test_v1_unchanged_and_v2_rejects_wrong_web_address(self):
        for story in seven.STORIES:
            video = seven.template(story)["videos"][0]
            rows = layout_rows(video, corrected=False)
            self.assertTrue(self.check_rows(rows, video, v1.verify_layout)["all_frames_checked"])
            rows = layout_rows(video)
            subtitle = next(s for s in video["timeline"]["subtitles"] if s["text"] == "Kylo pont study.")
            row = next(r for r in rows if subtitle["start_ms"] <= r["frame"] * 1000 / 30 < subtitle["end_ms"])
            for record in row["records"]:
                if record.get("text") == "kylo.study":
                    record["text"] = "kylo.invalid"
            with self.assertRaisesRegex(ValueError, "seven_caption_missing"):
                self.check_rows(rows, video)

    def test_v2_still_rejects_missing_caption(self):
        video = seven.template("hajo")["videos"][0]
        rows = layout_rows(video)
        row = next(row for row in rows if any(r.get("kind") == "text" for r in row["records"]))
        row["records"] = [r for r in row["records"] if r["kind"] != "text"]
        with self.assertRaisesRegex(ValueError, "seven_caption_missing"):
            self.check_rows(rows, video)

    def test_v2_still_rejects_unsafe_bounds(self):
        video = seven.template("hajo")["videos"][0]
        rows = layout_rows(video)
        rows[0]["records"][0]["left"] = 64
        with self.assertRaisesRegex(ValueError, "seven_unsafe_bounds"):
            self.check_rows(rows, video)

    def test_v2_still_requires_every_frame(self):
        video = seven.template("hajo")["videos"][0]
        with self.assertRaisesRegex(ValueError, "seven_layout_frames_missing"):
            self.check_rows(layout_rows(video)[:-1], video)

    def test_v2_cannot_change_audio_or_timing(self):
        for field in ("audio_sha256", "duration_ms", "sceneFrames"):
            video = copy.deepcopy(seven.template("hajo")["videos"][0])
            video["timeline"][field] = None
            with self.assertRaisesRegex(ValueError, "seven_request_video_mismatch"):
                v2.projected_video(video)

    def test_audio_verification_still_delegates_to_unchanged_v1(self):
        video = seven.template("hajo")["videos"][0]
        with patch("seven_media.verify", side_effect=ValueError("seven_audio_waveform_mismatch")) as verify:
            with self.assertRaisesRegex(ValueError, "seven_audio_waveform_mismatch"):
                v2.verify("output", "audio", "layout", video)
        self.assertEqual(verify.call_args.args[:3], ("output", "audio", "layout"))
        self.assertEqual(verify.call_args.args[3], v2.projected_video(video))

    def test_container_verifier_is_checksum_pinned_v2_only(self):
        renderer = {"image": REVIEWED_IMAGE, "reviewed": True, "scenes": seven.SCENES}
        for story in seven.STORIES:
            manifest = seven.template(story)
            self.assertFalse(any("seven_media_v2.py" in m for m in audio_mounts(manifest, renderer)))
            manifest["version"] = "v2"
            self.assertTrue(any(m.endswith(":/app/validation/seven_media_v2.py:ro") for m in audio_mounts(manifest, renderer)))
        with tempfile.TemporaryDirectory() as root:
            here = Path(__file__).parent
            for name in CAPTION_V2_OVERLAYS:
                (Path(root) / name).write_bytes((here / name).read_bytes())
            (Path(root) / "seven_media_v2.py").write_text("tampered")
            with self.assertRaisesRegex(ValueError, "renderer_review_required"):
                audio_mounts(manifest, renderer, root)

    def test_both_release_lists_include_v2_verifier(self):
        here = Path(__file__).parent
        for name in ("install.sh", "activate-manager.sh"):
            self.assertIn("seven_media_v2.py", (here / name).read_text().split("for file in ")[1].split("; do")[0].split())


if __name__ == "__main__":
    unittest.main()