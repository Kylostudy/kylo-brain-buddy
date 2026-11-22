import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import seven_audio as audio
import seven_audio_runtime as runtime
import seven_preflight as preflight
import seven_stories as seven

HERE = Path(__file__).parent
# Owner-provided 16:02:09 UTC VPS observation and the exact approved MP3 decoded samples.
CASES = {
    "auto": (24.607347, 1083392), "hajo": (21.211429, 933888),
    "hatizsak": (20.192653, 888832), "malacpersely-uj": (22.935510, 1009664),
    "repulo": (23.405714, 1030144), "szamlatorony": (23.405714, 1030144),
    "ust": (24.241633, 1067008),
}


class DecodedAudioTests(unittest.TestCase):
    def test_all_seven_vps_padded_durations_accept_exact_original_samples(self):
        for story, (padded, samples) in CASES.items():
            with self.subTest(story=story), tempfile.TemporaryDirectory() as root:
                probe = json.dumps({"format": {"duration": str(padded)}, "streams": [{"codec_type": "audio", "sample_rate": "44100", "channels": 1}]})
                with patch.object(seven, "STORIES", [story]), \
                        patch.object(preflight, "checked_file", return_value=True), \
                        patch.object(subprocess, "check_output", return_value=probe), \
                        patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=b"\0\0" * samples)), \
                        patch.object(Path, "read_text", return_value=json.dumps({"characters": ["a"], "character_start_times_seconds": [0], "character_end_times_seconds": [.1]})):
                    report = preflight.run(root)
                self.assertTrue(report["input_ok"])
                row = report["stories"][0]
                self.assertEqual(row["audio_measurement"]["samples"], samples)
                self.assertGreaterEqual(row["audio_measurement"]["outro_hold_us"], 2000000)
                self.assertFalse(row["skipped_checks"])
                self.assertFalse(report["render_started"])

    def test_real_shortening_still_rejected_at_two_ms_limit(self):
        with self.assertRaisesRegex(ValueError, "seven_audio_duration"):
            audio.validate_duration({"samples": 1083392 - 133, "sample_rate": 44100, "channels": 1}, 24.566712, 26600)

    def test_less_than_two_seconds_outro_still_rejected(self):
        with self.assertRaisesRegex(ValueError, "seven_audio_duration"):
            audio.validate_duration({"samples": 44100, "sample_rate": 44100, "channels": 1}, 1, 2999)

    def test_empty_decode_is_failure(self):
        with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=b"")):
            with self.assertRaisesRegex(ValueError, "seven_audio_duration"):
                audio.decode("input", {"sample_rate": 44100, "channels": 1})

    def test_channels_count_is_not_mistaken_for_extra_duration(self):
        with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=b"\0" * 44100 * 4)) as command:
            measured = audio.decode("input", {"sample_rate": 44100, "channels": 2})
        self.assertEqual(measured["samples"], 44100)
        self.assertNotIn("-ar", command.call_args.args[0])
        self.assertNotIn("-ac", command.call_args.args[0])

    def test_multiple_audio_streams_rejected(self):
        with patch.object(subprocess, "check_output", return_value=json.dumps({"streams": [{"codec_type": "audio"}] * 2})):
            with self.assertRaisesRegex(ValueError, "seven_audio_duration"):
                audio.probe("input")


class AudioOverlayTests(unittest.TestCase):
    def renderer(self):
        return {"image": runtime.REVIEWED_IMAGE, "reviewed": True, "scenes": seven.SCENES}

    def test_all_seven_exact_trials_receive_only_readonly_overlays(self):
        for story in seven.STORIES:
            mounts = runtime.audio_mounts(seven.template(story), self.renderer())
            self.assertEqual(len(mounts), 4)
            self.assertTrue(all(value.endswith(":ro") for value in mounts[1::2]))

    def test_legacy_renderer_receives_no_mounts(self):
        self.assertEqual(runtime.audio_mounts({"recipe_id": "ielts-trial", "renderer": "ielts-promo-v1"}, {}), [])

    def test_other_image_rejected(self):
        renderer = self.renderer(); renderer["image"] = "sha256:" + "a" * 64
        with self.assertRaisesRegex(ValueError, "renderer_review_required"):
            runtime.audio_mounts(seven.template("hajo"), renderer)

    def test_missing_overlay_fails_closed(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(ValueError, "renderer_review_required"):
                runtime.audio_mounts(seven.template("hajo"), self.renderer(), root)

    def test_changed_or_writable_overlay_fails_closed(self):
        with tempfile.TemporaryDirectory() as root:
            for name in runtime.OVERLAYS:
                shutil.copyfile(HERE / name, Path(root) / name)
                (Path(root) / name).chmod(0o644)
            self.assertEqual(len(runtime.audio_mounts(seven.template("hajo"), self.renderer(), root)), 4)
            (Path(root) / "seven_audio.py").chmod(0o666)
            with self.assertRaisesRegex(ValueError, "renderer_review_required"):
                runtime.audio_mounts(seven.template("hajo"), self.renderer(), root)
            (Path(root) / "seven_audio.py").chmod(0o644)
            (Path(root) / "seven_audio.py").write_text("changed")
            with self.assertRaisesRegex(ValueError, "renderer_review_required"):
                runtime.audio_mounts(seven.template("hajo"), self.renderer(), root)

    def test_release_lists_include_every_overlay_dependency(self):
        for script in ("install.sh", "activate-manager.sh"):
            text = (HERE / script).read_text()
            for name in ("seven_audio.py", "seven_audio_runtime.py", "seven_audio_index.ts"):
                self.assertIn(name, text)

    def test_failed_legacy_selfcheck_remains_blocking_with_precise_host_stage(self):
        with tempfile.TemporaryDirectory() as root:
            config = {"renderers": {seven.RENDERER: self.renderer()}, "work_root": root,
                      "archive_root": root, "min_free_bytes": 0, "max_disk_fraction": 1}
            path = Path(root) / "config.json"
            path.write_text(json.dumps(config))
            (Path(root) / "reviewed-renderers.json").write_text(json.dumps(config["renderers"]))
            with patch.object(subprocess, "check_output", return_value=runtime.REVIEWED_IMAGE), \
                    patch("universal_runtime.self_check", return_value={"ok": False}):
                report = preflight.run(root, path)
            self.assertEqual(report["errors"][0]["stage"], "legacy_full_self_check")
            self.assertEqual(report["errors"][0]["reason"], "seven_legacy_self_check_failed")
            self.assertFalse(report["preparation_ok"])


if __name__ == "__main__":
    unittest.main()