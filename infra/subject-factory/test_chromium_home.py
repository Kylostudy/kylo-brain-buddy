"""Guard the real crashpad regression without weakening archive protections."""
from pathlib import Path
import shlex
import unittest


class ChromiumHomeTests(unittest.TestCase):
    def test_browser_home_is_inside_existing_writable_tmp_mount(self):
        unit = Path(__file__).with_name("kylo-subject-factory.service.reviewed").read_text()
        command = next(line.removeprefix("ExecStart=") for line in unit.splitlines() if line.startswith("ExecStart="))
        args = shlex.split(command)
        env = dict(args[i + 1].split("=", 1) for i, arg in enumerate(args) if arg == "-e")
        self.assertEqual(env["HOME"], "/tmp")
        self.assertEqual(env["XDG_CONFIG_HOME"], "/tmp/.config")
        self.assertEqual(env["XDG_CACHE_HOME"], "/tmp/.cache")
        self.assertIn("--read-only", args)
        self.assertEqual(args[args.index("--tmpfs") + 1], "/tmp:rw,size=512m")


if __name__ == "__main__":
    unittest.main()