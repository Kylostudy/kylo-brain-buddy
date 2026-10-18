import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("runtime_worker", Path(__file__).with_name("runtime-worker.py"))
runtime = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runtime)


class StagingCorrectionTests(unittest.TestCase):
    def expression(self, environment):
        source = runtime.corrected_source(runtime.OLD)
        with patch.dict(os.environ, environment, clear=True):
            return eval(source, {"os": os, "target": Path("/archive/sl/kozgaz-21.mp4")})

    def test_explicit_staging_does_not_evaluate_nonexistent_fourth_parent(self):
        self.assertEqual(self.expression({"KYLO_ARCHIVE_STAGING": "/archive-staging"}), "/archive-staging")

    def test_default_stays_outside_permanent_archive(self):
        self.assertEqual(self.expression({}), "/factory-staging")

    def test_unreviewed_source_is_rejected(self):
        with self.assertRaises(ValueError):
            runtime.corrected_source("unknown factory")

    def test_only_staging_expression_changes(self):
        untouched = 'os.link(stage, target)\n# archive conflict; existing file untouched\n'
        self.assertEqual(runtime.corrected_source(untouched + runtime.OLD), untouched + runtime.NEW)


if __name__ == "__main__":
    unittest.main()