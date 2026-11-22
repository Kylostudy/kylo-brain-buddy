import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import seven_series as series
from agent import Runner, refresh_series_renderer
from test_seven_series import SeriesTests
from seven_series_preflight import run


class RendererRefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.config_path, self.reviewed_path = root / 'config.json', root / 'reviewed.json'
        self.entry = {'image': 'sha256:' + 'd' * 64, 'reviewed': True, 'scenes': series.SCENES}
        self.config = {'renderers': {'legacy': {'image': 'unchanged'}}, 'cpus': 1, 'machine_secret': 'untouched'}
        self.original = copy.deepcopy(self.config)
        self.write(self.entry, self.entry)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, entry, reviewed):
        self.config_path.write_text(json.dumps({'renderers': {series.RENDERER: entry}, 'cpus': 2}))
        self.reviewed_path.write_text(json.dumps({series.RENDERER: reviewed}))

    def refresh(self):
        refresh_series_renderer(self.config, self.config_path, self.reviewed_path)

    def test_late_install_refreshes_only_new_binding(self):
        self.refresh()
        expected = copy.deepcopy(self.original)
        expected['renderers'][series.RENDERER] = self.entry
        self.assertEqual(self.config, expected)

    def test_missing_disk_entry_never_falls_back_to_reviewed(self):
        self.write(None, self.entry)
        with self.assertRaisesRegex(ValueError, '^seven_series_renderer_binding$'):
            self.refresh()
        self.assertEqual(self.config, self.original)

    def test_reviewed_mismatch_fails_closed(self):
        self.write(self.entry, {**self.entry, 'image': 'sha256:' + 'e' * 64})
        with self.assertRaisesRegex(ValueError, '^seven_series_renderer_binding$'):
            self.refresh()
        self.assertEqual(self.config, self.original)

    def test_wrong_scene_grant_rejected(self):
        entry = {**self.entry, 'scenes': ['seven-stories-hajo-hu-v1']}
        self.write(entry, entry)
        with self.assertRaisesRegex(ValueError, '^seven_series_renderer_binding$'):
            self.refresh()

    def test_changed_existing_pin_rejected(self):
        self.config['renderers'][series.RENDERER] = {**self.entry, 'image': 'sha256:' + 'e' * 64}
        before = copy.deepcopy(self.config)
        with self.assertRaisesRegex(ValueError, '^immutable_renderer_conflict$'):
            self.refresh()
        self.assertEqual(self.config, before)

    def test_invalid_digest_rejected(self):
        entry = {**self.entry, 'image': 'mutable:latest'}
        self.write(entry, entry)
        with self.assertRaisesRegex(ValueError, '^seven_series_renderer_digest$'):
            self.refresh()

    def test_real_aggregate_after_late_install_records_all_182_inputs(self):
        fixture = SeriesTests('test_preflight_checks_every_one_of_182_inputs')
        fixture.setUp()
        try:
            fixture.setup_series()
            self.config.update(recipe_root=fixture.temp.name, work_root=fixture.temp.name,
                               archive_root=fixture.temp.name, min_free_bytes=0, max_disk_fraction=1)
            self.refresh()
            with patch('seven_series_preflight.input_check', return_value={'ok': True}), \
                 patch('seven_series_preflight.anchors', return_value={}), \
                 patch('seven_series_preflight.Path.read_text', return_value=self.reviewed_path.read_text()), \
                 patch('seven_series_preflight.subprocess.check_output', return_value=self.entry['image']), \
                 patch('seven_series_preflight.subprocess.run'), \
                 patch('universal_runtime.self_check', return_value={'ok': True}):
                report = run(self.config, fixture.state)
            self.assertTrue(report['ok'], report['errors'])
            self.assertEqual(len(report['recipe_hashes']), 7)
            self.assertEqual(len(report['videos']), 182)
            self.assertEqual(report['image'], self.entry['image'])
            self.assertFalse(report['render_started'])
        finally:
            fixture.tearDown()

    def test_series_render_refreshes_before_gate_and_never_renders_on_missing_binding(self):
        runner = Runner({'archive_root': self.temp.name}, None)
        with patch('agent.refresh_series_renderer', side_effect=ValueError('seven_series_renderer_binding')) as refresh, \
             patch('seven_series_state.before_render') as gate:
            with self.assertRaisesRegex(ValueError, '^seven_series_renderer_binding$'):
                runner.render({'manifest': {'recipe_id': series.recipe_id('hajo')}})
            refresh.assert_called_once_with(runner.config)
            gate.assert_not_called()


if __name__ == '__main__':
    unittest.main()