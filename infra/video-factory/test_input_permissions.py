"""Recipe access regression tests: no production or network access."""
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from storage import checksum
from inputs import readable_inputs


class PermissionsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.parent = Path(self.tmp.name)
        self.root = self.parent / "recipe"
        self.root.mkdir(mode=0o700)
        self.audio = self.root / "vo-ja-mp3"
        self.audio.write_bytes(b"Japanese audio fixture")
        self.audio.chmod(0o600)
        self.media = {"key": "vo-ja-mp3", "bytes": self.audio.stat().st_size, "sha256": checksum(self.audio)}

    def test_existing_japanese_audio_readable_without_content_change(self):
        readable_inputs(self.root, [self.media])
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE(self.audio.stat().st_mode), 0o444)
        self.assertEqual(checksum(self.audio), self.media["sha256"])
        self.assertEqual(stat.S_IMODE(self.parent.stat().st_mode), 0o700)

    @unittest.skipUnless(os.geteuid() == 0, "UID transition requires root")
    def test_renderer_uid_65532_can_read_japanese_audio(self):
        self.parent.chmod(0o755)  # Test mount parent, not production ancestors.
        def renderer_uid():
            os.setgroups([])
            os.setgid(65532)
            os.setuid(65532)
        before = subprocess.run(["/usr/bin/head", "-c", "1", str(self.audio)], preexec_fn=renderer_uid, capture_output=True)
        self.assertNotEqual(before.returncode, 0)
        readable_inputs(self.root, [self.media])
        after = subprocess.run(["/usr/bin/head", "-c", "1", str(self.audio)], preexec_fn=renderer_uid, capture_output=True)
        self.assertEqual(after.returncode, 0)
        self.assertEqual(after.stdout, b"J")

    def test_corrupt_input_permissions_unchanged(self):
        self.audio.write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "media_checksum_failed"):
            readable_inputs(self.root, [self.media])
        self.assertEqual(stat.S_IMODE(self.audio.stat().st_mode), 0o600)

    def test_symlink_never_changes_outside_permissions(self):
        outside = self.parent / "outside"
        outside.write_bytes(self.audio.read_bytes())
        outside.chmod(0o600)
        self.audio.unlink()
        self.audio.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "symlink_not_allowed"):
            readable_inputs(self.root, [self.media])
        self.assertEqual(stat.S_IMODE(outside.stat().st_mode), 0o600)

    def test_nested_recipe_font_is_readable(self):
        fonts = self.root / "fonts"
        fonts.mkdir(mode=0o700)
        font = fonts / "notosans-jp-ttf"
        font.write_bytes(b"font fixture")
        font.chmod(0o600)
        readable_inputs(self.root, [{"key": "fonts/notosans-jp-ttf", "bytes": font.stat().st_size, "sha256": checksum(font)}])
        self.assertEqual(stat.S_IMODE(fonts.stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE(font.stat().st_mode), 0o444)


if __name__ == "__main__":
    unittest.main()