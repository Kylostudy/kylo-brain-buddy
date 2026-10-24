import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CompletionTests(unittest.TestCase):
    def test_completed_receipt_prevents_restart(self):
        completed = load("completion-state").completed
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "status.json"
            path.write_text('{"status":"completed","current":null,"verified_count":1274}')
            self.assertTrue(completed(path))
            path.write_text('{"status":"rendering","current":"sl/topic","verified_count":1274}')
            self.assertFalse(completed(path))

    def test_missing_container_after_completed_run_is_success(self):
        run = Mock(side_effect=[subprocess.CompletedProcess([], 1, b"", b"missing"), subprocess.CompletedProcess([], 0, b"other-container\n", b"")])
        self.assertEqual(load("stop-container").stop(run), 0)
        self.assertEqual(run.call_count, 2)

    def test_docker_outage_is_not_success(self):
        run = Mock(return_value=subprocess.CompletedProcess([], 1, b"", b"daemon unavailable"))
        self.assertEqual(load("stop-container").stop(run), 1)


if __name__ == "__main__":
    unittest.main()