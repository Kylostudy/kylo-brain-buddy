import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('prepare_trial', Path(__file__).with_name('prepare-ielts-trial.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TrialTests(unittest.TestCase):
    def test_archive_traversal_rejected(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as z:
            z.writestr('../outside', b'x')
        with zipfile.ZipFile(buf) as z:
            with self.assertRaisesRegex(ValueError, 'unsafe_member'):
                module.verify_members(z)

    def test_only_czech_one_video_allowed(self):
        for languages, videos in [(['cs', 'de'], [{}]), (['cs'], [{}, {}])]:
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, 'w') as z:
                z.writestr('source/manifest.json', json.dumps({'recipe_id': 'ielts-cs-trial', 'version': 'v1', 'languages': languages, 'videos': videos}))
            with zipfile.ZipFile(buf) as z:
                with self.assertRaisesRegex(ValueError, 'single_czech_trial_required'):
                    module.verify_members(z)

    def test_existing_recipe_never_overwritten(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'audio'
            module.exclusive_file(target, b'original')
            with self.assertRaisesRegex(ValueError, 'existing_recipe_conflict'):
                module.exclusive_file(target, b'changed')
            self.assertEqual(target.read_bytes(), b'original')

    def test_symlink_parent_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            link = Path(root) / 'link'
            link.symlink_to(root, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'symlink_destination'):
                module.exclusive_file(link / 'outside', b'blocked')
            self.assertFalse((Path(root) / 'outside').exists())

import sys
sys.path.insert(0, str(Path(__file__).parent))
trial_spec = importlib.util.spec_from_file_location('ielts_trial', Path(__file__).with_name('ielts-trial.py'))
trial = importlib.util.module_from_spec(trial_spec)
trial_spec.loader.exec_module(trial)
from state import State


def failed_trial(root):
    state = State(Path(root) / 'state.sqlite3')
    with state.transaction() as db:
        db.execute("INSERT INTO recipes VALUES('ielts-cs-trial','v1','h','{}')")
        db.execute("INSERT INTO jobs(id,recipe,version,mode,status,attempts) VALUES('0f1e2d3c-4b5a-4968-8776-655443322110','ielts-cs-trial','v1','trial','failed',1)")
        state.emit(db, 'final_error', '0f1e2d3c-4b5a-4968-8776-655443322110', {'code': 'render_or_verification_failed'})
    scratch = Path(root) / '0f1e2d3c-4b5a-4968-8776-655443322110' / '0'
    scratch.mkdir(parents=True)
    (scratch / 'output.mp4').write_bytes(b'stale-shortened-render')
    return state


class TrialRetryTests(unittest.TestCase):
    def test_failed_trial_retried_once_with_stale_scratch_removed(self):
        with tempfile.TemporaryDirectory() as root:
            state = failed_trial(root)
            self.assertTrue(trial.retry_failed_trial(state, {'work_root': root}))
            self.assertFalse((Path(root) / '0f1e2d3c-4b5a-4968-8776-655443322110').exists())
            with state.transaction() as db:
                self.assertEqual(db.execute("SELECT status FROM jobs").fetchone()[0], 'queued')
                db.execute("UPDATE jobs SET status='failed', attempts=2")
            self.assertFalse(trial.retry_failed_trial(state, {'work_root': root}))

    def test_completed_output_never_retried(self):
        with tempfile.TemporaryDirectory() as root:
            state = failed_trial(root)
            with state.transaction() as db:
                db.execute("INSERT INTO outputs VALUES('ielts-cs-trial/v1/ielts-cs','{}')")
            self.assertFalse(trial.retry_failed_trial(state, {'work_root': root}))
            self.assertTrue((Path(root) / '0f1e2d3c-4b5a-4968-8776-655443322110' / '0' / 'output.mp4').exists())

    def test_last_error_code_reported(self):
        with tempfile.TemporaryDirectory() as root:
            state = failed_trial(root)
            self.assertEqual(trial.last_error(state, '0f1e2d3c-4b5a-4968-8776-655443322110'), 'render_or_verification_failed')


if __name__ == '__main__':
    unittest.main()
