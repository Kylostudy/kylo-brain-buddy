import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("stop_browser_work", Path(__file__).with_name("stop-browser-work.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class BrowserRetirementTests(unittest.TestCase):
    def test_factory_and_other_projects_never_selected(self):
        for image in ["kylo-video-factory:latest", "kylo-subject-factory:20261018", "postgres:16", "exam-promo-profiles-safe-v4"]:
            self.assertIsNone(module.kind({"Config": {"Image": image}}))

    def test_only_verified_worker_containers_selected(self):
        self.assertEqual(module.kind({"Config": {"Image": "kylo-executor:latest", "Env": ["SPEC_FILE=/job/spec.json", "RUN_ID=320d6184-0a05-4bbe-a672-0134ea63b0e9"]}}), "executor")
        self.assertIsNone(module.kind({"Config": {"Image": "kylo-executor:latest", "Env": []}}))

    def test_nonbrowser_audio_and_archive_preserved(self):
        self.assertEqual(module.NON_BROWSER, {"ping", "stt_media_fetch", "stt_calibrate", "archive_video", "membership_transcribe", "receive_subject_factory_package"})

if __name__ == "__main__":
    unittest.main()