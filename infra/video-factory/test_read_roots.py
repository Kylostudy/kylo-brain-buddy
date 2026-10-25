"""Legacy archive receipts are verified read-only; new videos still save under the factory root."""
from pathlib import Path
import tempfile
import unittest
from storage import LocalArchive, checksum


class ReadRootTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.legacy = base / "brain"
        (self.legacy / "videos/nyelvvizsga-promo").mkdir(parents=True)
        self.video = self.legacy / "videos/nyelvvizsga-promo/kylo-ielts-de-9x16.mp4"
        self.video.write_bytes(b"de-video")
        self.receipt = {"storage_type": "local", "object_key": "videos/nyelvvizsga-promo/kylo-ielts-de-9x16",
                        "bytes": 8, "sha256": checksum(self.video), "read_root": "brain-archive"}
        self.archive = LocalArchive(base / "factory", {"brain-archive": self.legacy})

    def test_legacy_receipt_verifies_from_brain_archive(self):
        self.assertTrue(self.archive.verify(self.receipt))

    def test_legacy_receipt_without_configured_root_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "read_root_not_configured"):
            LocalArchive(Path(self.tmp.name) / "other").verify(self.receipt)

    def test_missing_completed_video_is_named(self):
        with self.assertRaisesRegex(ValueError, "completed_video_missing:factory:videos/nyelvvizsga-promo/kylo-ielts-de-9x16"):
            self.archive.verify({**self.receipt, "read_root": None})

    def test_changed_legacy_file_is_rejected(self):
        self.video.write_bytes(b"tampered")
        self.assertFalse(self.archive.verify(self.receipt))

    def test_unknown_alias_cannot_be_configured(self):
        with self.assertRaisesRegex(ValueError, "unknown_read_root"):
            LocalArchive(Path(self.tmp.name) / "x", {"anything": "/"})

    def test_legacy_symlink_is_rejected(self):
        self.video.unlink()
        other = Path(self.tmp.name) / "outside.mp4"
        other.write_bytes(b"de-video")
        self.video.symlink_to(other)
        with self.assertRaisesRegex(ValueError, "symlink_not_allowed"):
            self.archive.verify(self.receipt)

    def test_read_root_symlink_is_rejected(self):
        alias = Path(self.tmp.name) / "alias"
        alias.symlink_to(self.legacy, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlink_not_allowed"):
            LocalArchive(Path(self.tmp.name) / "x", {"brain-archive": alias})

    def test_missing_legacy_file_names_root_and_key(self):
        self.video.unlink()
        with self.assertRaisesRegex(ValueError, "completed_video_missing:brain-archive:videos/nyelvvizsga-promo/kylo-ielts-de-9x16"):
            self.archive.verify(self.receipt)

    def test_new_videos_still_save_under_factory_root(self):
        receipt = self.archive.save("ielts-series/v3/ielts-da", self.video, {})
        self.assertNotIn("read_root", receipt)
        self.assertTrue((Path(self.tmp.name) / "factory/ielts-series/v3/ielts-da.mp4").is_file())


if __name__ == "__main__":
    unittest.main()
