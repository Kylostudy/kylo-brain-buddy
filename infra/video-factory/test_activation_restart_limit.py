import unittest
from pathlib import Path

SCRIPT = (Path(__file__).parent / "activate-manager.sh").read_text()


class ActivationRestartLimit(unittest.TestCase):
    def test_activations_are_serialized(self):
        lock = SCRIPT.index("flock -w 900 9")
        self.assertLess(lock, SCRIPT.index("systemctl restart kylo-video-factory.service"))

    def test_planned_restart_clears_start_limit_first(self):
        restart = SCRIPT.index("systemctl restart kylo-video-factory.service")
        before = SCRIPT[:restart].rsplit("\n", 3)
        self.assertIn("systemctl reset-failed kylo-video-factory.service", "\n".join(before))

    def test_active_render_still_blocks_restart(self):
        guard = SCRIPT.index("grep -qx kylo-video-factory-render")
        self.assertLess(guard, SCRIPT.index("systemctl restart kylo-video-factory.service"))


if __name__ == "__main__":
    unittest.main()
