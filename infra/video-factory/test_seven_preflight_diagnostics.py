import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import seven_preflight as preflight
import seven_stories as seven


class PreflightDiagnostics(unittest.TestCase):
    def report(self, probe_error=None, decode_error=None, alignment_error=None):
        def probe(*args, **kwargs):
            if probe_error is not None:
                raise probe_error
            return json.dumps({"format": {"duration": seven.APPROVED["stories"]["auto"]["timeline"]["audio_duration_seconds"]}, "streams": [{"codec_type": "audio"}]})

        with tempfile.TemporaryDirectory() as root, \
                patch.object(seven, "STORIES", ["auto"]), \
                patch.object(preflight, "checked_file", return_value=True), \
                patch.object(subprocess, "check_output", side_effect=probe), \
                patch.object(subprocess, "run", side_effect=decode_error), \
                patch.object(Path, "read_text", side_effect=alignment_error):
            return preflight.run(root)

    def test_missing_probe_is_distinct_from_bad_audio(self):
        report = self.report(probe_error=FileNotFoundError(2, "private-path"))
        error = report["stories"][0]["errors"][0]
        self.assertEqual(error["stage"], "audio_probe")
        self.assertEqual(error["errno"], 2)
        self.assertFalse(report["input_ok"])
        self.assertNotIn("private-path", json.dumps(report))

    def test_decode_exit_is_redacted_and_blocks_preparation(self):
        failure = subprocess.CalledProcessError(1, ["ffmpeg", "private-path"], stderr=b"secret-url")
        report = self.report(decode_error=failure)
        error = report["stories"][0]["errors"][0]
        self.assertEqual(error["stage"], "full_audio_decode")
        self.assertEqual(error["returncode"], 1)
        self.assertFalse(report["preparation_ok"])
        self.assertNotIn("secret-url", json.dumps(report))
        self.assertNotIn("private-path", json.dumps(report))

    def test_completed_decode_is_not_reported_as_skipped_after_alignment_failure(self):
        report = self.report(alignment_error=UnicodeDecodeError("ascii", b"\xff", 0, 1, "private-text"))
        row = report["stories"][0]
        self.assertEqual(row["errors"][0]["stage"], "alignment")
        self.assertIn("full_audio_decode", row["checked"])
        self.assertNotIn("full_audio_decode", row["skipped_checks"])
        self.assertFalse(report["input_ok"])

    def test_unknown_exception_text_is_never_exported(self):
        detail = preflight.failure_detail(ValueError("private-url?token=secret"), "alignment")
        self.assertEqual(detail, {"stage": "alignment", "exception": "ValueError"})

    def test_timeout_is_not_mislabeled_as_missing_tool(self):
        report = self.report(probe_error=subprocess.TimeoutExpired("private-command", 30))
        error = report["stories"][0]["errors"][0]
        self.assertEqual(error["exception"], "TimeoutExpired")
        self.assertEqual(error["stage"], "audio_probe")
        self.assertNotIn("errno", error)


if __name__ == "__main__":
    unittest.main()